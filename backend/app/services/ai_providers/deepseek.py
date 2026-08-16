"""DeepSeek text provider used by the call-script workshop."""

import httpx

from ..ai_provider import AIProvider, VoiceResult
from ...config import settings
from .mock import MockProvider


_CHAT_URL = "{base}/chat/completions"


class DeepSeekProvider(AIProvider):
    """Generate concise, natural Chinese call scripts through DeepSeek."""

    name = "deepseek"

    def __init__(self, api_key: str | None = None):
        self.api_key = api_key

    def _require_key(self) -> str:
        key = self.api_key or settings.deepseek_api_key
        if not key:
            raise RuntimeError("未配置 DeepSeek API Key，请在“我的 API KEY”中填写，或检查后端环境变量。")
        return key

    def generate_excuse(self, scene_type: str, contact_role: str, tone: str = "温柔自然") -> str:
        key = self._require_key()
        prompt = (
            "请用简体中文写一段自然、可信、不冒犯的来电话术。"
            f"使用场景：{scene_type}；来电人身份：{contact_role}；语气：{tone}。"
            "内容应像真实电话中的一句或两句短话，40 个汉字以内；"
            "不要解释写作过程，不要标题、引号、列表或表情。"
        )
        try:
            response = httpx.post(
                _CHAT_URL.format(base=settings.deepseek_base_url.rstrip("/")),
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json={
                    "model": settings.deepseek_chat_model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.8,
                    "max_tokens": 120,
                },
                timeout=httpx.Timeout(30.0, connect=10.0),
                trust_env=False,
            )
        except httpx.RequestError as error:
            raise RuntimeError("无法连接 DeepSeek 服务，请检查网络连接后重试。") from error

        if response.status_code in (401, 403):
            raise RuntimeError("DeepSeek API Key 无效或没有该模型权限，请在“我的 API KEY”中检查后重试。")
        if response.status_code == 429:
            raise RuntimeError("DeepSeek 请求过于频繁或余额不足，请稍后重试并检查账户额度。")
        if response.is_error:
            raise RuntimeError("DeepSeek 暂时无法生成话术，请稍后重试。")

        try:
            content = response.json()["choices"][0]["message"]["content"].strip()
        except (KeyError, IndexError, TypeError, ValueError) as error:
            raise RuntimeError("DeepSeek 返回内容异常，请稍后再试。") from error
        if not content:
            raise RuntimeError("DeepSeek 没有返回有效话术，请稍后重试。")
        return content

    def generate_voice(self, text: str) -> VoiceResult:
        # DeepSeek does not supply TTS; telephone audio uses the selected voice provider.
        return MockProvider().generate_voice(text)
