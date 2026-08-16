"""语音文件落盘 + VoiceFile 记录。"""
import os
from uuid import uuid4

from sqlalchemy.orm import Session

from .. import models
from ..config import settings
from .ai_provider import VoiceResult


def save_voice(
    db: Session,
    user_id: int | None,
    text: str,
    result: VoiceResult,
    *,
    voice_id: str | None = None,
    voice_name: str | None = None,
    scene_type: str | None = None,
) -> models.VoiceFile:
    os.makedirs(settings.voice_dir, exist_ok=True)
    filename = f"voice_{uuid4().hex}.{result.format}"
    filepath = os.path.join(settings.voice_dir, filename)
    with open(filepath, "wb") as f:
        f.write(result.audio_bytes)

    vf = models.VoiceFile(
        user_id=user_id,
        text=text,
        audio_path=filename,
        audio_url=f"/voices/{filename}",
        format=result.format,
        duration_ms=result.duration_ms,
        provider=result.provider,
    )
    db.add(vf)
    db.flush()

    profile = None
    if voice_id:
        profile = db.query(models.VoiceProfile).filter(
            models.VoiceProfile.provider_voice_id == voice_id
        ).first()
    script_version = db.query(models.ScriptVersion).filter(
        models.ScriptVersion.content == text
    ).order_by(models.ScriptVersion.created_at.desc()).first()
    script = db.get(models.Script, script_version.script_id) if script_version else None
    scene = None
    if script:
        scene = db.query(models.Scene).filter(models.Scene.name == script.scene).first()

    db.add(models.VoiceGeneration(
        user_id=user_id,
        voice_profile_id=profile.id if profile else None,
        script_version_id=script_version.id if script_version else None,
        scene_id=scene.id if scene else None,
        voice_file_id=vf.id,
        voice_name_snapshot=voice_name or (profile.name if profile else voice_id) or "系统声音",
        script_snapshot=text,
        scene_snapshot=scene_type or (script.scene if script else None),
        audio_path=filename,
        duration_ms=result.duration_ms,
        status="success",
    ))
    db.commit()
    db.refresh(vf)
    return vf
