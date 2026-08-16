"""OpenAI Provider（文本补全 + TTS）。需配置 OPENAI_API_KEY。"""
import httpx

from ..ai_provider import AIProvider, VoiceResult
from ...config import settings

_CHAT_URL = "{base}/chat/completions"
_TTS_URL = "{base}/audio/speech"


class OpenAIProvider(AIProvider):
    name = "openai"

    def _require_key(self) -> str:
        if not settings.openai_api_key:
            raise RuntimeError("未配置 OPENAI_API_KEY，无法使用 OpenAI Provider")
        return settings.openai_api_key

    def generate_excuse(self, scene_type: str, contact_role: str, tone: str = "自然") -> str:
        key = self._require_key()
        prompt = (
            f"你现在是{contact_role}，需要给一位正在{scene_type}的朋友打一通电话，"
            f"帮他自然地结束这场社交。请用一句{contact_role}的口吻、{tone}的语气，"
            f"生成一段不超过 40 字的离开理由，直接输出这句话，不要解释。"
        )
        resp = httpx.post(
            _CHAT_URL.format(base=settings.openai_base_url),
            headers={"Authorization": f"Bearer {key}"},
            json={
                "model": settings.openai_chat_model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.8,
            },
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()

    def generate_voice(self, text: str) -> VoiceResult:
        key = self._require_key()
        resp = httpx.post(
            _TTS_URL.format(base=settings.openai_base_url),
            headers={"Authorization": f"Bearer {key}"},
            json={"model": settings.openai_tts_model, "input": text, "voice": "alloy"},
            timeout=60,
        )
        resp.raise_for_status()
        return VoiceResult(
            audio_bytes=resp.content,
            format="mp3",
            duration_ms=0,  # OpenAI 音频接口不返回时长，客户端按文件自行计算
            provider=self.name,
        )
