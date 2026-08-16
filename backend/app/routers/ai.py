"""AI 能力：生成离开理由（文本）+ 生成语音（TTS）。"""
import os

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from .. import schemas
from ..database import get_db
from .. import models
from ..services.ai_provider import get_provider
from ..services.voice_storage import save_voice
from ..config import settings

router = APIRouter(prefix="/ai", tags=["ai"])


@router.get("/voice-plans", response_model=list[schemas.VoicePlanOut])
def list_voice_plans(db: Session = Depends(get_db)):
    """返回所有成功生成且音频仍可用的电话语音方案。"""
    system_voice_names = {
        "female-shaonv": "温柔女声",
        "male-qn-qingse": "沉稳男声",
        "female-tianmei": "活力青年",
    }
    rows = (
        db.query(models.VoiceGeneration, models.VoiceFile, models.VoiceProfile)
        .join(models.VoiceFile, models.VoiceGeneration.voice_file_id == models.VoiceFile.id)
        .join(models.VoiceProfile, models.VoiceGeneration.voice_profile_id == models.VoiceProfile.id)
        .filter(
            models.VoiceGeneration.status == "success",
            models.VoiceProfile.status == "ready",
        )
        .order_by(models.VoiceGeneration.created_at.desc(), models.VoiceGeneration.id.desc())
        .all()
    )
    result = []
    for generation, voice_file, profile in rows:
        filename = os.path.basename(voice_file.audio_path or generation.audio_path or "")
        if not filename or not os.path.isfile(os.path.join(settings.voice_dir, filename)):
            continue
        raw_voice_name = generation.voice_name_snapshot or (profile.name if profile else None) or "系统声音"
        voice_name = system_voice_names.get(raw_voice_name, raw_voice_name)
        scene_type = generation.scene_snapshot or "自定义场景"
        result.append({
            "id": generation.id,
            "owner_name": voice_name,
            "voice_name": voice_name,
            "scene_type": scene_type,
            "text": generation.script_snapshot,
            "audio_url": voice_file.audio_url,
            "duration_ms": generation.duration_ms or voice_file.duration_ms or 0,
        })
    return result


@router.post("/excuse", response_model=schemas.ExcuseResponse)
def generate_excuse(
    payload: schemas.ExcuseRequest,
    deepseek_api_key: str | None = Header(None, alias="X-DeepSeek-API-Key"),
    minimax_api_key: str | None = Header(None, alias="X-MiniMax-API-Key"),
):
    provider_name = settings.ai_provider
    provider_key = deepseek_api_key if provider_name.lower() == "deepseek" else minimax_api_key if provider_name.lower() == "minimax" else None
    provider = get_provider(provider_name, api_key=provider_key) if provider_key else get_provider(provider_name)
    try:
        reason = provider.generate_excuse(payload.scene_type, payload.contact_role, payload.tone)
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return schemas.ExcuseResponse(reason=reason, provider=provider.name)


@router.get("/history", response_model=list[schemas.ExcuseHistoryOut])
def list_excuse_history(db: Session = Depends(get_db)):
    scripts = db.query(models.Script).order_by(models.Script.created_at.desc()).limit(50).all()
    result = []
    for script in scripts:
        version = db.get(models.ScriptVersion, script.current_version_id) if script.current_version_id else None
        if not version and script.versions:
            version = script.versions[-1]
        if version:
            result.append({
                "id": script.id,
                "user_id": script.user_id,
                "scene_type": script.scene,
                "contact_role": script.contact_role or "联系人",
                "voice_id": script.voice_id,
                "voice_name": script.voice_name,
                "text": version.content,
                "created_at": script.created_at,
            })
    return result


@router.post("/history", response_model=schemas.ExcuseHistoryOut)
def save_excuse_history(payload: schemas.ExcuseHistoryCreate, db: Session = Depends(get_db)):
    script = models.Script(
        user_id=payload.user_id,
        title=f"{payload.scene_type}话术",
        scene=payload.scene_type,
        contact_role=payload.contact_role,
        voice_id=payload.voice_id,
        voice_name=payload.voice_name,
    )
    db.add(script)
    db.flush()
    version = models.ScriptVersion(
        script_id=script.id,
        version_number=1,
        content=payload.text,
        source="manual",
    )
    db.add(version)
    db.flush()
    script.current_version_id = version.id
    db.commit()
    db.refresh(script)
    return {
        "id": script.id,
        **payload.model_dump(),
        "created_at": script.created_at,
    }


@router.delete("/history/{history_id}")
def delete_excuse_history(history_id: int, db: Session = Depends(get_db)):
    item = db.get(models.Script, history_id)
    if not item:
        return {"ok": True}
    db.delete(item)
    db.commit()
    return {"ok": True}


@router.post("/voice", response_model=schemas.VoiceResponse)
def generate_voice(
    payload: schemas.VoiceRequest,
    db: Session = Depends(get_db),
    minimax_api_key: str | None = Header(None, alias="X-MiniMax-API-Key"),
):
    provider = get_provider(payload.provider, api_key=minimax_api_key) if minimax_api_key and payload.provider == "minimax" else get_provider(payload.provider)
    try:
        if provider.name == "minimax":
            result = provider.generate_voice(
                payload.text,
                voice_id=payload.voice_id,
                speed=payload.speed,
                pitch=payload.pitch,
                emotion=payload.emotion,
                pause_sec=payload.pause_sec,
                telephone=payload.telephone,
            )
        else:
            result = provider.generate_voice(payload.text)
    except (RuntimeError, ValueError) as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    vf = save_voice(
        db,
        payload.user_id,
        payload.text,
        result,
        voice_id=payload.voice_id,
        voice_name=payload.voice_name,
        scene_type=payload.scene_type,
    )
    return schemas.VoiceResponse(
        voice_file_id=vf.id,
        audio_url=vf.audio_url,
        duration_ms=vf.duration_ms,
        provider=vf.provider,
        format=vf.format,
        sample_rate=result.sample_rate,
        telephone=result.telephone,
    )
