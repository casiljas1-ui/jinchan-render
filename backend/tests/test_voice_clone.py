import io
import wave
from pathlib import Path

import httpx

from app import models
from app.database import SessionLocal
from app.routers import voice_clones
from app.services import minimax_voice_clone
from app.services.minimax_voice_clone import MiniMaxCloneError


def wav_bytes(seconds: float, sample_rate: int = 16000) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(sample_rate)
        audio.writeframes(b"\x00\x00" * int(seconds * sample_rate))
    return buffer.getvalue()


def upload_payload(seconds: float = 12):
    return {"file": ("reference.wav", wav_bytes(seconds), "audio/wav")}


def test_clone_rejects_missing_consent(client):
    response = client.post(
        "/api/ai/voices/clone",
        data={"voice_name": "我的声音", "consent_confirmed": "false"},
        files=upload_payload(),
    )
    assert response.status_code == 400
    assert "授权" in response.json()["detail"]


def test_clone_rejects_unsupported_format(client):
    response = client.post(
        "/api/ai/voices/clone",
        data={"voice_name": "我的声音", "consent_confirmed": "true"},
        files={"file": ("reference.txt", b"not audio", "text/plain")},
    )
    assert response.status_code == 400
    assert "仅支持" in response.json()["detail"]


def test_clone_rejects_file_over_20mb(client):
    response = client.post(
        "/api/ai/voices/clone",
        data={"voice_name": "我的声音", "consent_confirmed": "true"},
        files={"file": ("reference.wav", b"0" * (20 * 1024 * 1024 + 1), "audio/wav")},
    )
    assert response.status_code == 413


def test_clone_rejects_short_recording(client):
    response = client.post(
        "/api/ai/voices/clone",
        data={"voice_name": "我的声音", "consent_confirmed": "true"},
        files=upload_payload(2),
    )
    assert response.status_code == 400
    assert "10 秒" in response.json()["detail"]


def test_clone_success_saves_and_lists_real_voice_id(client, monkeypatch):
    monkeypatch.setattr(voice_clones, "upload_clone_sample", lambda path: "123456")
    captured = {}

    def fake_clone(file_id, voice_id, preview_text=None):
        captured.update(file_id=file_id, voice_id=voice_id, preview_text=preview_text)
        return {"base_resp": {"status_code": 0}}

    monkeypatch.setattr(voice_clones, "create_clone", fake_clone)
    response = client.post(
        "/api/ai/voices/clone",
        data={
            "voice_name": "妈妈的声音",
            "consent_confirmed": "true",
            "preview_text": "你好，这是试听文本。",
        },
        files=upload_payload(),
    )
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["name"] == "妈妈的声音"
    assert data["provider_voice_id"].startswith("jinchan_")
    assert len(data["provider_voice_id"]) == 32
    assert data["provider_file_id"] == "123456"
    assert data["status"] == "ready"
    assert captured["voice_id"] == data["provider_voice_id"]

    listed = client.get("/api/ai/voices")
    assert listed.status_code == 200
    assert listed.json()[0]["provider_voice_id"] == data["provider_voice_id"]
    with SessionLocal() as db:
        record = db.query(models.ClonedVoice).one()
        assert record.provider_file_id == "123456"
        assert Path(record.recording_path).suffix == ".wav"


def test_clone_upload_failure_is_safe_and_not_saved(client, monkeypatch):
    monkeypatch.setattr(
        voice_clones,
        "upload_clone_sample",
        lambda path: (_ for _ in ()).throw(MiniMaxCloneError("MiniMax 参考录音上传失败（HTTP 500）。")),
    )
    response = client.post(
        "/api/ai/voices/clone",
        data={"voice_name": "失败音色", "consent_confirmed": "true"},
        files=upload_payload(),
    )
    assert response.status_code == 502
    assert "MINIMAX_API_KEY" not in response.text
    assert client.get("/api/ai/voices").json() == []


def test_clone_creation_failure_is_safe_and_not_saved(client, monkeypatch):
    monkeypatch.setattr(voice_clones, "upload_clone_sample", lambda path: "123")
    monkeypatch.setattr(
        voice_clones,
        "create_clone",
        lambda *args, **kwargs: (_ for _ in ()).throw(MiniMaxCloneError("MiniMax 声音复刻失败（代码 1001）。")),
    )
    response = client.post(
        "/api/ai/voices/clone",
        data={"voice_name": "失败音色", "consent_confirmed": "true"},
        files=upload_payload(),
    )
    assert response.status_code == 502
    assert client.get("/api/ai/voices").json() == []


def test_minimax_file_upload_success_and_failure(monkeypatch, tmp_path):
    sample = tmp_path / "sample.wav"
    sample.write_bytes(wav_bytes(12))
    calls = []

    def success_post(url, **kwargs):
        calls.append((url, kwargs))
        return httpx.Response(200, json={"file": {"file_id": 7788}, "base_resp": {"status_code": 0}})

    monkeypatch.setattr(minimax_voice_clone.httpx, "post", success_post)
    assert minimax_voice_clone.upload_clone_sample(sample) == "7788"
    assert calls[0][1]["data"]["purpose"] == "voice_clone"

    monkeypatch.setattr(
        minimax_voice_clone.httpx,
        "post",
        lambda *args, **kwargs: httpx.Response(500, json={"secret": "must-not-leak"}),
    )
    try:
        minimax_voice_clone.upload_clone_sample(sample)
        assert False, "expected MiniMaxCloneError"
    except MiniMaxCloneError as error:
        assert "must-not-leak" not in str(error)


def test_minimax_clone_success_and_failure(monkeypatch):
    captured = {}

    def success_post(url, **kwargs):
        captured.update(kwargs["json"])
        return httpx.Response(200, json={"base_resp": {"status_code": 0}})

    monkeypatch.setattr(minimax_voice_clone.httpx, "post", success_post)
    minimax_voice_clone.create_clone("123", "jinchan_1234567890abcdef123456", "试听")
    assert captured["file_id"] == 123
    assert captured["voice_id"].startswith("jinchan_")

    monkeypatch.setattr(
        minimax_voice_clone.httpx,
        "post",
        lambda *args, **kwargs: httpx.Response(200, json={"base_resp": {"status_code": 1004, "status_msg": "upstream details"}}),
    )
    try:
        minimax_voice_clone.create_clone("123", "jinchan_1234567890abcdef123456")
        assert False, "expected MiniMaxCloneError"
    except MiniMaxCloneError as error:
        assert "upstream details" not in str(error)
