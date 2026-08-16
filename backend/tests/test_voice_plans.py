from pathlib import Path

from app import models
from app.config import settings
from app.database import SessionLocal


def _add_plan(*, owner: str, text: str, filename: str, status: str = "success"):
    Path(settings.voice_dir).mkdir(parents=True, exist_ok=True)
    Path(settings.voice_dir, filename).write_bytes(b"RIFF-test-wave")
    with SessionLocal() as db:
        profile = models.VoiceProfile(
            name=owner,
            provider_voice_id=f"voice-{filename}",
            source_filename="reference.wav",
            recording_path="reference.wav",
            recording_url="/recordings/reference.wav",
            status="ready",
        )
        voice_file = models.VoiceFile(
            text=text,
            audio_path=filename,
            audio_url=f"/voices/{filename}",
            format="wav",
            duration_ms=16000,
            provider="minimax",
        )
        db.add_all([profile, voice_file])
        db.flush()
        db.add(models.VoiceGeneration(
            voice_profile_id=profile.id,
            voice_file_id=voice_file.id,
            voice_name_snapshot=owner,
            script_snapshot=text,
            audio_path=filename,
            duration_ms=16000,
            status=status,
        ))
        db.commit()


def test_voice_plan_library_only_returns_successful_available_clone_audio(client):
    _add_plan(owner="妈妈", text="饭做好了，你什么时候回来呀？", filename="ready.wav")
    _add_plan(owner="同事", text="这条生成失败。", filename="failed.wav", status="failed")

    data = client.get("/api/ai/voice-plans").json()

    assert len(data) == 1
    assert data[0] == {
        "id": data[0]["id"],
        "owner_name": "妈妈",
        "voice_name": "妈妈",
        "scene_type": "自定义场景",
        "text": "饭做好了，你什么时候回来呀？",
        "audio_url": "/voices/ready.wav",
        "duration_ms": 16000,
    }


def test_voice_plan_library_hides_missing_audio(client):
    _add_plan(owner="闺蜜小林", text="到家告诉我。", filename="missing.wav")
    Path(settings.voice_dir, "missing.wav").unlink()

    assert client.get("/api/ai/voice-plans").json() == []


def test_voice_plan_library_includes_system_voice(client):
    Path(settings.voice_dir).mkdir(parents=True, exist_ok=True)
    filename = "system-ready.wav"
    Path(settings.voice_dir, filename).write_bytes(b"RIFF-test-wave")
    with SessionLocal() as db:
        voice_file = models.VoiceFile(
            text="家里有事，请早点回来。",
            audio_path=filename,
            audio_url=f"/voices/{filename}",
            format="wav",
            duration_ms=5200,
            provider="minimax",
        )
        db.add(voice_file)
        db.flush()
        db.add(models.VoiceGeneration(
            voice_file_id=voice_file.id,
            voice_name_snapshot="温柔女声",
            script_snapshot="家里有事，请早点回来。",
            scene_snapshot="聚餐脱身",
            audio_path=filename,
            duration_ms=5200,
            status="success",
        ))
        db.commit()

    data = client.get("/api/ai/voice-plans").json()
    assert data[0]["voice_name"] == "温柔女声"
    assert data[0]["scene_type"] == "聚餐脱身"
