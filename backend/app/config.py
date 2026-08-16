"""应用配置。

所有可变配置通过环境变量 / .env 注入，默认值面向 Hackathon Demo：
- 数据库默认 SQLite
- AI Provider 默认 mock（离线可跑，无需 API Key）
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "金婵 AI社交自由助手"
    app_version: str = "0.1.0"
    api_prefix: str = "/api"

    # 数据库
    database_url: str = "sqlite:///./database/jinchan.db"

    # AI Provider: mock | openai | deepseek | minimax
    # mock = 离线可用，用于 Demo 跑通链路；切换真实厂商只需改这里 + 填对应 key
    ai_provider: str = "mock"

    # OpenAI
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_chat_model: str = "gpt-4o-mini"
    openai_tts_model: str = "tts-1"

    # DeepSeek（仅文本补全，语音需另行指定）
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_chat_model: str = "deepseek-chat"

    # MiniMax（文本 + TTS）
    minimax_api_key: str = ""
    minimax_group_id: str = ""
    minimax_text_model: str = "MiniMax-M2.7"
    minimax_tts_model: str = "speech-2.8-hd"
    minimax_voice_id: str = "male-qn-qingse"

    # 语音文件存储目录（相对 backend 运行目录）
    voice_dir: str = "./storage/audio/calls/generated"
    recording_dir: str = "./storage/audio/voices/originals"
    cloned_voice_dir: str = "./storage/audio/voices/cloned"
    ffmpeg_path: str = ""


settings = Settings()
