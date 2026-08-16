"""真人录音校验、MiniMax 声音复刻和本地音色库接口。"""

from __future__ import annotations

import os
import shutil
import tempfile
import wave
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Response, UploadFile
from sqlalchemy.orm import Session

from .. import models, schemas
from ..config import settings
from ..database import get_db
from ..services.minimax_voice_clone import (
    MiniMaxCloneError,
    create_clone,
    upload_clone_sample,
)
from tools.minimax_clone import run_ffmpeg


router = APIRouter(prefix="/voice-clones", tags=["voice-clones-compat"])
ai_voice_router = APIRouter(prefix="/ai/voices", tags=["ai-voices"])

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MIN_DURATION_MS = 10_000
MAX_DURATION_MS = 300_000
SUPPORTED_SUFFIXES = {".mp3", ".m4a", ".wav", ".webm", ".ogg", ".mp4"}


def _write_limited_upload(upload: UploadFile, target: Path) -> None:
    total = 0
    with target.open("wb") as output:
        while chunk := upload.file.read(1024 * 1024):
            total += len(chunk)
            if total > MAX_UPLOAD_BYTES:
                raise HTTPException(413, "参考录音不能超过 20MB。")
            output.write(chunk)
    if total == 0:
        raise HTTPException(400, "参考录音不能为空。")


def _convert_to_wav(source: Path, target: Path) -> int:
    try:
        run_ffmpeg(
            [
                "-i", str(source),
                "-ar", "16000",
                "-ac", "1",
                "-c:a", "pcm_s16le",
                str(target),
            ],
            ffmpeg_path=settings.ffmpeg_path or None,
        )
    except RuntimeError as error:
        message = str(error)
        if message.startswith("未找到 FFmpeg"):
            raise HTTPException(500, message) from error
        raise HTTPException(400, "无法读取参考录音，请确认文件没有损坏。") from error
    try:
        with wave.open(str(target), "rb") as audio:
            if audio.getframerate() != 16000 or audio.getnchannels() != 1 or audio.getsampwidth() != 2:
                raise HTTPException(500, "参考录音转换后的音频规格不正确。")
            return int(audio.getnframes() / audio.getframerate() * 1000)
    except wave.Error as error:
        raise HTTPException(400, "参考录音转换失败。") from error


def _prepare_upload(upload: UploadFile, work_dir: Path) -> tuple[Path, int]:
    suffix = Path(upload.filename or "").suffix.lower()
    if suffix not in SUPPORTED_SUFFIXES:
        raise HTTPException(400, "仅支持 MP3、M4A、WAV 等常见音频文件。")
    source = work_dir / f"source{suffix}"
    _write_limited_upload(upload, source)
    wav_path = work_dir / "clone_sample.wav"
    duration_ms = _convert_to_wav(source, wav_path)
    if duration_ms < MIN_DURATION_MS:
        raise HTTPException(400, "参考录音至少需要 10 秒。")
    if duration_ms > MAX_DURATION_MS:
        raise HTTPException(400, "参考录音不能超过 5 分钟。")
    return wav_path, duration_ms


def _new_voice_id(db: Session) -> str:
    for _ in range(5):
        # MiniMax voice_id 使用字母、数字、下划线；该格式固定为 32 个字符。
        voice_id = f"jinchan_{uuid4().hex[:24]}"
        exists = db.query(models.ClonedVoice.id).filter(models.ClonedVoice.provider_voice_id == voice_id).first()
        if not exists:
            return voice_id
    raise HTTPException(500, "无法生成唯一音色 ID，请重试。")


@router.post("/analyze")
@ai_voice_router.post("/analyze")
def analyze_recording(file: UploadFile = File(...)):
    with tempfile.TemporaryDirectory(prefix="jinchan_analyze_") as temp_dir:
        wav_path, duration_ms = _prepare_upload(file, Path(temp_dir))
        with wave.open(str(wav_path), "rb") as audio:
            return {
                "ok": True,
                "duration_ms": duration_ms,
                "sample_rate": audio.getframerate(),
                "channels": audio.getnchannels(),
                "message": "参考录音长度和格式检测通过。",
            }


@router.post("", response_model=schemas.ClonedVoiceOut, status_code=201)
@ai_voice_router.post("/clone", response_model=schemas.ClonedVoiceOut, status_code=201)
def clone_voice(
    file: UploadFile = File(...),
    voice_name: str | None = Form(None),
    consent_confirmed: bool | None = Form(None),
    preview_text: str | None = Form(None),
    # 兼容旧网页字段，新的网页只发送上面的正式字段。
    name: str | None = Form(None),
    consent: bool | None = Form(None),
    user_id: int | None = Form(None),
    minimax_api_key: str | None = Header(None, alias="X-MiniMax-API-Key"),
    db: Session = Depends(get_db),
):
    confirmed = consent_confirmed if consent_confirmed is not None else consent
    if confirmed is not True:
        raise HTTPException(400, "必须确认已获得声音本人明确授权。")
    clean_name = (voice_name or name or "").strip()
    if not clean_name:
        raise HTTPException(400, "请填写音色名称。")
    if len(clean_name) > 30:
        raise HTTPException(400, "音色名称不能超过 30 个字符。")

    with tempfile.TemporaryDirectory(prefix="jinchan_clone_") as temp_dir:
        wav_path, duration_ms = _prepare_upload(file, Path(temp_dir))
        voice_id = _new_voice_id(db)
        try:
            provider_file_id = upload_clone_sample(wav_path, minimax_api_key) if minimax_api_key else upload_clone_sample(wav_path)
            create_clone(provider_file_id, voice_id, preview_text, minimax_api_key) if minimax_api_key else create_clone(provider_file_id, voice_id, preview_text)
        except MiniMaxCloneError as error:
            raise HTTPException(502, str(error)) from error
        except Exception as error:
            raise HTTPException(502, "声音复刻失败，请稍后重试。") from error

        os.makedirs(settings.recording_dir, exist_ok=True)
        stored_name = f"recording_{uuid4().hex}.wav"
        stored_path = Path(settings.recording_dir) / stored_name
        shutil.copy2(wav_path, stored_path)

    record = models.ClonedVoice(
        user_id=user_id,
        name=clean_name,
        provider_voice_id=voice_id,
        provider_file_id=provider_file_id,
        provider="minimax",
        source_filename=file.filename or "recording",
        recording_path=stored_name,
        recording_url=f"/recordings/{stored_name}",
        duration_ms=duration_ms,
        status="ready",
    )
    try:
        db.add(record)
        db.commit()
        db.refresh(record)
    except Exception:
        db.rollback()
        stored_path.unlink(missing_ok=True)
        raise HTTPException(500, "音色已复刻，但本地保存失败，请重试。")
    return record


@router.get("", response_model=list[schemas.ClonedVoiceOut])
@ai_voice_router.get("", response_model=list[schemas.ClonedVoiceOut])
def list_cloned_voices(user_id: int | None = None, db: Session = Depends(get_db)):
    query = db.query(models.ClonedVoice).filter(models.ClonedVoice.status == "ready")
    if user_id is not None:
        query = query.filter(models.ClonedVoice.user_id == user_id)
    return query.order_by(models.ClonedVoice.created_at.desc()).all()


@router.delete("/{voice_id}", status_code=204)
@ai_voice_router.delete("/{voice_id}", status_code=204)
def delete_cloned_voice(voice_id: int, db: Session = Depends(get_db)):
    record = db.get(models.ClonedVoice, voice_id)
    if not record:
        raise HTTPException(404, "音色不存在。")
    Path(settings.recording_dir, record.recording_path).unlink(missing_ok=True)
    db.delete(record)
    db.commit()
    return Response(status_code=204)
