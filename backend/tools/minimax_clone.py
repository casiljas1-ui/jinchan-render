"""MiniMax 分句 TTS、FFmpeg 统一转换、静音拼接和电话音质处理。"""

from __future__ import annotations

import re
import shutil
import subprocess
import wave
from pathlib import Path

import httpx


MINIMAX_BASE_URL = "https://api.minimaxi.com/v1"
TELEPHONE_FILTER = (
    "highpass=f=300,lowpass=f=3400,"
    "acompressor=threshold=-18dB:ratio=3:attack=5:release=80,"
    "volume=3dB,alimiter=limit=0.95"
)


class MiniMaxTTSError(RuntimeError):
    """可安全返回给前端的 MiniMax TTS 错误。"""


def find_ffmpeg(configured_path: str | None = None) -> str:
    """优先使用配置路径，然后查询 PATH 和常见的 Windows 本地位置。"""
    candidates = [configured_path, shutil.which("ffmpeg")]
    if shutil.which("where"):
        candidates.extend(
            [
                str(Path.cwd() / "ffmpeg.exe"),
                str(Path.cwd() / "bin" / "ffmpeg.exe"),
            ]
        )
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return str(Path(candidate))
    raise RuntimeError("未找到 FFmpeg。请安装 FFmpeg 并加入 PATH，或设置 FFMPEG_PATH。")


def run_ffmpeg(args: list[str], *, ffmpeg_path: str | None = None) -> None:
    executable = find_ffmpeg(ffmpeg_path)
    completed = subprocess.run(
        [executable, "-hide_banner", "-loglevel", "error", "-y", *args],
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        message = completed.stderr.strip().splitlines()[-1] if completed.stderr.strip() else "未知错误"
        raise RuntimeError(f"FFmpeg 处理失败：{message[:240]}")


def split_spoken_sentences(text: str) -> list[str]:
    """按中文停顿标点切为适合逐句 TTS 的短句，并保留标点。"""
    cleaned = re.sub(r"\s+", " ", text or "").strip()
    if not cleaned:
        return []
    # 省略号作为一个边界；句号、问号、感叹号和逗号均形成自然停顿。
    parts = re.findall(r".*?(?:……|\.\.\.|[。！？!?，,；;]|$)", cleaned)
    return [part.strip() for part in parts if part and part.strip()]


def _safe_minimax_error(response: httpx.Response, action: str) -> MiniMaxTTSError:
    if response.status_code == 401:
        return MiniMaxTTSError(f"MiniMax {action}鉴权失败，请检查后端 API Key。")
    if response.status_code == 402:
        return MiniMaxTTSError(f"MiniMax {action}余额不足或计费未开通。")
    if response.status_code == 429:
        return MiniMaxTTSError(f"MiniMax {action}请求过于频繁，请稍后重试。")
    return MiniMaxTTSError(f"MiniMax {action}失败（HTTP {response.status_code}）。")


def tts_sentence(
    text: str,
    voice_id: str,
    out_path: Path,
    *,
    api_key: str,
    model: str,
    speed: float = 1.0,
    pitch: int = 0,
    emotion: str = "calm",
    sample_rate: int = 32000,
    ffmpeg_path: str | None = None,
) -> Path:
    """调用一次 MiniMax TTS，并把 hex MP3 转为统一 PCM WAV。"""
    try:
        response = httpx.post(
            f"{MINIMAX_BASE_URL}/t2a_v2",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "text": text,
                "stream": False,
                "voice_setting": {
                    "voice_id": voice_id,
                    "speed": max(0.5, min(float(speed), 2.0)),
                    "vol": 1.0,
                    "pitch": max(-12, min(int(pitch), 12)),
                    "emotion": emotion,
                },
                "audio_setting": {
                    "format": "mp3",
                    "sample_rate": sample_rate,
                    "bitrate": 128000,
                    "channel": 1,
                },
                "subtitle_enable": False,
            },
            timeout=90,
        )
    except httpx.RequestError as error:
        raise MiniMaxTTSError("无法连接 MiniMax 语音服务，请检查网络后重试。") from error
    if not response.is_success:
        raise _safe_minimax_error(response, "语音生成")
    try:
        data = response.json()
    except ValueError as error:
        raise MiniMaxTTSError("MiniMax 语音服务返回了无法解析的数据。") from error
    base_resp = data.get("base_resp") or {}
    status_code = base_resp.get("status_code", 0)
    if status_code not in (0, None):
        raise MiniMaxTTSError(f"MiniMax 语音生成失败（代码 {status_code}）。")
    audio_hex = (data.get("data") or {}).get("audio")
    if not audio_hex:
        raise MiniMaxTTSError("MiniMax 未返回语音数据。")
    try:
        mp3_bytes = bytes.fromhex(audio_hex)
    except (TypeError, ValueError) as error:
        raise MiniMaxTTSError("MiniMax 返回的语音数据格式无效。") from error

    out_path.parent.mkdir(parents=True, exist_ok=True)
    mp3_path = out_path.with_suffix(".mp3")
    try:
        mp3_path.write_bytes(mp3_bytes)
        run_ffmpeg(
            [
                "-i", str(mp3_path),
                "-ar", str(sample_rate),
                "-ac", "1",
                "-c:a", "pcm_s16le",
                str(out_path),
            ],
            ffmpeg_path=ffmpeg_path,
        )
    finally:
        mp3_path.unlink(missing_ok=True)
    return out_path


def _assert_pcm_wav(path: Path, sample_rate: int) -> None:
    try:
        with wave.open(str(path), "rb") as audio:
            valid = (
                audio.getframerate() == sample_rate
                and audio.getnchannels() == 1
                and audio.getsampwidth() == 2
                and audio.getcomptype() == "NONE"
            )
    except (wave.Error, OSError) as error:
        raise RuntimeError(f"分句音频不是有效 WAV：{path.name}") from error
    if not valid:
        raise RuntimeError(f"分句音频规格不一致：{path.name}")


def merge_with_pause(
    sentence_wavs: list[Path],
    out_dir: Path,
    *,
    pause_sec: float = 0.45,
    sample_rate: int = 32000,
    ffmpeg_path: str | None = None,
) -> Path:
    """拼接统一 WAV，并输出唯一需要保存的 8kHz 电话版临时文件。"""
    if not sentence_wavs:
        raise ValueError("没有可用于生成语音的有效分句。")
    if not 0.05 <= float(pause_sec) <= 2.0:
        raise ValueError("句间停顿必须在 0.05 至 2.0 秒之间。")
    out_dir.mkdir(parents=True, exist_ok=True)
    for wav_path in sentence_wavs:
        _assert_pcm_wav(wav_path, sample_rate)

    silence = out_dir / "silence.wav"
    run_ffmpeg(
        [
            "-f", "lavfi",
            "-i", f"anullsrc=r={sample_rate}:cl=mono",
            "-t", f"{float(pause_sec):.3f}",
            "-ar", str(sample_rate),
            "-ac", "1",
            "-c:a", "pcm_s16le",
            str(silence),
        ],
        ffmpeg_path=ffmpeg_path,
    )

    concat_file = out_dir / "concat.txt"
    ordered: list[Path] = []
    for index, wav_path in enumerate(sentence_wavs):
        ordered.append(wav_path.resolve())
        if index < len(sentence_wavs) - 1:
            ordered.append(silence.resolve())
    concat_file.write_text(
        "\n".join(f"file '{str(item).replace(chr(39), chr(39) + chr(92) + chr(39) + chr(39))}'" for item in ordered),
        encoding="utf-8",
    )

    raw_path = out_dir / "joined_32k.wav"
    run_ffmpeg(
        ["-f", "concat", "-safe", "0", "-i", str(concat_file), "-c:a", "pcm_s16le", str(raw_path)],
        ffmpeg_path=ffmpeg_path,
    )
    final_path = out_dir / "telephone_8k.wav"
    run_ffmpeg(
        [
            "-i", str(raw_path),
            "-af", TELEPHONE_FILTER,
            "-ar", "8000",
            "-ac", "1",
            "-c:a", "pcm_s16le",
            str(final_path),
        ],
        ffmpeg_path=ffmpeg_path,
    )
    _assert_pcm_wav(final_path, 8000)
    return final_path


def synthesize_pipeline(
    sentences: list[str],
    voice_id: str,
    out_dir: Path,
    *,
    api_key: str,
    model: str,
    speed: float = 1.0,
    pitch: int = 0,
    emotion: str = "calm",
    pause_sec: float = 0.45,
    ffmpeg_path: str | None = None,
) -> Path:
    """逐句合成后拼接，返回电话版 WAV；调用方的临时目录负责自动清理。"""
    if not sentences:
        raise ValueError("没有可用于生成语音的有效分句。")
    wavs: list[Path] = []
    for index, text in enumerate(sentences, 1):
        wav_path = out_dir / f"s{index}.wav"
        try:
            tts_sentence(
                text,
                voice_id,
                wav_path,
                api_key=api_key,
                model=model,
                speed=speed,
                pitch=pitch,
                emotion=emotion,
                sample_rate=32000,
                ffmpeg_path=ffmpeg_path,
            )
        except Exception as error:
            if isinstance(error, MiniMaxTTSError):
                raise MiniMaxTTSError(f"第 {index} 个分句生成失败：{error}") from error
            raise RuntimeError(f"第 {index} 个分句处理失败：{error}") from error
        wavs.append(wav_path)
    return merge_with_pause(
        wavs,
        out_dir,
        pause_sec=pause_sec,
        sample_rate=32000,
        ffmpeg_path=ffmpeg_path,
    )
