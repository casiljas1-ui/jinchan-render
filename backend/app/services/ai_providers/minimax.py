"""MiniMax provider for short-copy generation and synchronous TTS."""

import re
import tempfile
import wave
from pathlib import Path

import httpx

from ..ai_provider import AIProvider, VoiceResult
from ...config import settings
from tools.minimax_clone import split_spoken_sentences, synthesize_pipeline

_BASE = "https://api.minimaxi.com/v1"


class MiniMaxProvider(AIProvider):
    name = "minimax"

    def __init__(self, api_key: str | None = None):
        self.api_key = api_key

    def _headers(self) -> dict[str, str]:
        if not (self.api_key or settings.minimax_api_key):
            raise RuntimeError("未配置 MINIMAX_API_KEY")
        return {
            "Authorization": f"Bearer {self.api_key or settings.minimax_api_key}",
            "Content-Type": "application/json",
        }

    @staticmethod
    def _check_response(data: dict) -> None:
        base_resp = data.get("base_resp") or {}
        status_code = base_resp.get("status_code", 0)
        if status_code not in (0, None):
            message = base_resp.get("status_msg") or "MiniMax API 请求失败"
            raise RuntimeError(f"MiniMax {status_code}: {message}")

    def generate_excuse(
        self,
        scene_type: str,
        contact_role: str,
        tone: str = "自然",
    ) -> str:
        prompt = (
            f"你是来电人“{contact_role}”，正在给对方打电话，帮助对方自然离开“{scene_type}”。"
            f"使用{tone}的口语语气，写1到2个短句，总字数不超过60字。"
            "像真实电话而不是通知或客服播报：可以自然使用“喂、嗯、那个”等少量口语词，"
            "句子长短要有变化，用逗号、句号或省略号标出真实停顿。"
            "理由要可信但不能制造严重事故、疾病或恐慌。只输出实际要说的话，不要解释、标题或引号。"
        )
        response = httpx.post(
            f"{_BASE}/chat/completions",
            headers=self._headers(),
            json={
                "model": settings.minimax_text_model,
                "messages": [
                    {"role": "system", "content": "你是一名简洁、自然的中文来电话术助手。"},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.7,
                "max_completion_tokens": 512,
            },
            timeout=45,
        )
        if response.status_code == 402:
            raise RuntimeError("MiniMax 文案生成额度不足或计费未开通，请检查账户余额与文本模型权限")
        response.raise_for_status()
        data = response.json()
        self._check_response(data)
        content = data["choices"][0]["message"]["content"].strip()
        content = re.sub(r"<think>[\s\S]*?</think>", "", content).strip()
        return content

    def generate_voice(
        self,
        text: str,
        voice_id: str | None = None,
        speed: float | None = None,
        pitch: int | None = None,
        emotion: str | None = None,
        pause_sec: float | None = None,
        telephone: bool = True,
    ) -> VoiceResult:
        sentences = split_spoken_sentences(text)
        if not sentences:
            raise ValueError("语音文本不能为空")
        if not (self.api_key or settings.minimax_api_key):
            raise RuntimeError("未配置 MINIMAX_API_KEY。")
        if not telephone:
            raise ValueError("当前接口只生成电话版语音，请将 telephone 设为 true。")
        with tempfile.TemporaryDirectory(prefix="jinchan_tts_") as temp_dir:
            final_path = synthesize_pipeline(
                sentences,
                voice_id or settings.minimax_voice_id,
                Path(temp_dir),
                api_key=self.api_key or settings.minimax_api_key,
                model=settings.minimax_tts_model,
                speed=1.0 if speed is None else speed,
                pitch=0 if pitch is None else pitch,
                emotion=emotion or "calm",
                pause_sec=0.45 if pause_sec is None else pause_sec,
                ffmpeg_path=settings.ffmpeg_path or None,
            )
            audio_bytes = final_path.read_bytes()
            with wave.open(str(final_path), "rb") as audio:
                duration_ms = int(audio.getnframes() / audio.getframerate() * 1000)
        return VoiceResult(
            audio_bytes=audio_bytes,
            format="wav",
            duration_ms=duration_ms,
            provider=self.name,
            sample_rate=8000,
            telephone=True,
        )
