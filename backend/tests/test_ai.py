from app import models
from app.database import SessionLocal


def test_generate_excuse(client):
    r = client.post("/api/ai/excuse", json={"scene_type": "聚会", "contact_role": "老板"})
    assert r.status_code == 200
    data = r.json()
    assert data["reason"]
    assert data["provider"] == "mock"


def test_generate_voice_creates_playable_wav(client):
    r = client.post("/api/ai/voice", json={"text": "喂，公司有急事，快回来"})
    assert r.status_code == 200
    data = r.json()
    assert data["voice_file_id"] > 0
    assert data["audio_url"].startswith("/voices/")
    assert data["format"] == "wav"

    # 下载并校验是合法 WAV（验证「文件生成 -> 存储 -> 下载」链路）
    r2 = client.get(data["audio_url"])
    assert r2.status_code == 200
    assert r2.headers["content-type"].startswith("audio")
    assert r2.content[:4] == b"RIFF"
    assert r2.content[8:12] == b"WAVE"

    with SessionLocal() as db:
        generation = db.query(models.VoiceGeneration).one()
        assert generation.voice_file_id == data["voice_file_id"]
        assert generation.script_snapshot == "喂，公司有急事，快回来"
        assert generation.audio_path.endswith(".wav")
        assert generation.status == "success"


def test_history_uses_script_and_version_tables(client):
    payload = {
        "scene_type": "聚餐脱身",
        "contact_role": "妈妈",
        "voice_id": "jinchan_test_voice",
        "voice_name": "妈妈的声音",
        "text": "喂，家里临时有点事情，你现在方便回来一下吗？",
    }
    created = client.post("/api/ai/history", json=payload)
    assert created.status_code == 200

    items = client.get("/api/ai/history").json()
    assert len(items) == 1
    assert items[0]["text"] == payload["text"]

    with SessionLocal() as db:
        script = db.query(models.Script).one()
        version = db.query(models.ScriptVersion).one()
        assert script.current_version_id == version.id
        assert script.scene == "聚餐脱身"
        assert version.version_number == 1
        assert version.content == payload["text"]
