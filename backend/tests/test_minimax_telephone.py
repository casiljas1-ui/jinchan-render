import io
import os
import tempfile
import wave
from pathlib import Path

from app.config import settings
from app.routers import ai
from app.services.ai_provider import VoiceResult
from tools import minimax_clone


def write_wav(path: Path, *, sample_rate: int, seconds: float = 0.12):
    with wave.open(str(path), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(sample_rate)
        audio.writeframes(b"\x00\x00" * int(sample_rate * seconds))


def wav_bytes(sample_rate: int = 8000, seconds: float = 0.2) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(sample_rate)
        audio.writeframes(b"\x00\x00" * int(sample_rate * seconds))
    return buffer.getvalue()


def test_chinese_sentence_splitting():
    assert minimax_clone.split_spoken_sentences("喂，家里临时有事。你方便回来吗？好的……路上小心！") == [
        "喂，",
        "家里临时有事。",
        "你方便回来吗？",
        "好的……",
        "路上小心！",
    ]
    assert minimax_clone.split_spoken_sentences("   ") == []


def test_pipeline_calls_every_sentence_and_builds_8k_phone_wav(monkeypatch, tmp_path):
    calls = []

    def fake_tts(text, voice_id, out_path, **kwargs):
        calls.append((text, voice_id, kwargs))
        write_wav(out_path, sample_rate=32000)
        return out_path

    monkeypatch.setattr(minimax_clone, "tts_sentence", fake_tts)
    final_path = minimax_clone.synthesize_pipeline(
        ["第一句，", "第二句。", "第三句？"],
        "jinchan_real_voice_01",
        tmp_path,
        api_key="test-key",
        model="speech-2.8-hd",
        speed=0.95,
        pitch=0,
        emotion="calm",
        pause_sec=0.2,
    )
    assert [call[0] for call in calls] == ["第一句，", "第二句。", "第三句？"]
    assert all(call[1] == "jinchan_real_voice_01" for call in calls)
    assert all(call[2]["speed"] == 0.95 for call in calls)
    assert (tmp_path / "silence.wav").exists()
    with wave.open(str(final_path), "rb") as audio:
        assert audio.getframerate() == 8000
        assert audio.getnchannels() == 1
        assert audio.getsampwidth() == 2
        assert audio.getcomptype() == "NONE"
        duration = audio.getnframes() / audio.getframerate()
    assert duration >= 0.70  # 三段 0.12 秒 + 两段约 0.2 秒静音


def test_pipeline_reports_failed_sentence_number(monkeypatch, tmp_path):
    def fake_tts(text, voice_id, out_path, **kwargs):
        if text.startswith("第二"):
            raise minimax_clone.MiniMaxTTSError("模拟失败")
        write_wav(out_path, sample_rate=32000)
        return out_path

    monkeypatch.setattr(minimax_clone, "tts_sentence", fake_tts)
    try:
        minimax_clone.synthesize_pipeline(
            ["第一句。", "第二句。"],
            "jinchan_voice",
            tmp_path,
            api_key="test",
            model="speech-2.8-hd",
        )
        assert False, "expected failure"
    except minimax_clone.MiniMaxTTSError as error:
        assert "第 2 个分句" in str(error)


def test_invalid_pause_and_mismatched_wav_are_rejected(tmp_path):
    wav = tmp_path / "s1.wav"
    write_wav(wav, sample_rate=16000)
    try:
        minimax_clone.merge_with_pause([wav], tmp_path, pause_sec=0.45)
        assert False, "expected mismatch"
    except RuntimeError as error:
        assert "规格不一致" in str(error)
    try:
        minimax_clone.merge_with_pause([], tmp_path, pause_sec=0)
        assert False, "expected empty error"
    except ValueError:
        pass


def test_voice_endpoint_forwards_all_minimax_parameters_and_downloads_only_final(client, monkeypatch):
    captured = {}

    class FakeMiniMax:
        name = "minimax"

        def generate_voice(self, text, **kwargs):
            captured.update(text=text, **kwargs)
            return VoiceResult(
                audio_bytes=wav_bytes(),
                format="wav",
                duration_ms=200,
                provider="minimax",
                sample_rate=8000,
                telephone=True,
            )

    monkeypatch.setattr(ai, "get_provider", lambda name=None: FakeMiniMax())
    response = client.post(
        "/api/ai/voice",
        json={
            "text": "第一句。第二句？",
            "provider": "minimax",
            "voice_id": "jinchan_real_voice_01",
            "speed": 0.95,
            "pitch": 2,
            "emotion": "calm",
            "pause_sec": 0.45,
            "telephone": True,
        },
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert captured == {
        "text": "第一句。第二句？",
        "voice_id": "jinchan_real_voice_01",
        "speed": 0.95,
        "pitch": 2,
        "emotion": "calm",
        "pause_sec": 0.45,
        "telephone": True,
    }
    assert data["sample_rate"] == 8000
    assert data["telephone"] is True
    assert data["format"] == "wav"
    files = os.listdir(settings.voice_dir)
    assert files == [Path(data["audio_url"]).name]
    assert not any(name.startswith(("s", "silence", "concat", "joined")) for name in files)
    download = client.get(data["audio_url"])
    assert download.status_code == 200
    with wave.open(io.BytesIO(download.content), "rb") as audio:
        assert audio.getframerate() == 8000
        assert audio.getnchannels() == 1
        assert audio.getsampwidth() == 2


def test_temporary_pipeline_directory_is_cleaned(monkeypatch):
    created = None

    def fake_tts(text, voice_id, out_path, **kwargs):
        write_wav(out_path, sample_rate=32000)
        return out_path

    monkeypatch.setattr(minimax_clone, "tts_sentence", fake_tts)
    with tempfile.TemporaryDirectory(prefix="jinchan_cleanup_test_") as temp_dir:
        created = Path(temp_dir)
        minimax_clone.synthesize_pipeline(
            ["测试。"], "voice", created, api_key="test", model="test"
        )
        assert any(created.iterdir())
    assert not created.exists()
