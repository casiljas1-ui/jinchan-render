"""AI Provider 抽象接口 + 工厂。

设计目标：不绑定具体厂商。文本（理由）与语音（TTS）都走同一抽象，
未来替换 OpenAI / DeepSeek / MiniMax 或其它厂商，只需新增一个实现类并在
工厂注册表里加一行，业务层（routers/ai.py、scene_plans.py）无需改动。
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass

from ..config import settings


@dataclass
class VoiceResult:
    """一次 TTS 的产物。"""
    audio_bytes: bytes
    format: str          # wav / mp3
    duration_ms: int
    provider: str
    sample_rate: int = 0
    telephone: bool = False


class AIProvider(ABC):
    name: str = "base"

    @abstractmethod
    def generate_excuse(self, scene_type: str, contact_role: str, tone: str = "自然") -> str:
        """根据场景 + 联系人角色，生成一段自然的离开理由。"""

    @abstractmethod
    def generate_voice(self, text: str) -> VoiceResult:
        """把理由文本合成为语音。"""


# 工厂：懒加载 + 注册表
def get_provider(name: str | None = None, api_key: str | None = None) -> AIProvider:
    key = (name or settings.ai_provider).lower()

    # 局部导入避免循环依赖（providers 包 import 基类，这里反向引用）
    from .ai_providers.mock import MockProvider
    from .ai_providers.openai import OpenAIProvider
    from .ai_providers.deepseek import DeepSeekProvider
    from .ai_providers.minimax import MiniMaxProvider

    registry = {
        "mock": MockProvider,
        "openai": OpenAIProvider,
        "deepseek": DeepSeekProvider,
        "minimax": MiniMaxProvider,
    }
    cls = registry.get(key)
    if cls is None:
        raise ValueError(f"未知 AI Provider: {key!r}，可选: {sorted(registry)}")
    return cls(api_key=api_key) if api_key else cls()
