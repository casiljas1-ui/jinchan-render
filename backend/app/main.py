"""金婵 Backend 入口。

启动：
    cd backend
    uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
"""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse

from . import models  # noqa: F401  确保模型注册到 Base.metadata
from .config import settings
from .database import Base, engine
from .bootstrap import initialize_local_data
from .routers import ai, devices, scene_plans, tasks, trigger, users, voice_clones

# 建表（Hackathon 阶段用 create_all；生产建议迁移工具）
Base.metadata.create_all(bind=engine)
initialize_local_data()

app = FastAPI(title=settings.app_name, version=settings.app_version)

# Demo 阶段全开 CORS，方便 Flutter Web / 真机调试
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok", "app": settings.app_name, "version": settings.app_version}


@app.get("/", include_in_schema=False)
def website_home():
    return RedirectResponse(url="/website/latest.html")


# 语音静态文件（audio_url 形如 /voices/xxx.wav）
os.makedirs(settings.voice_dir, exist_ok=True)
app.mount("/voices", StaticFiles(directory=settings.voice_dir), name="voices")
os.makedirs(settings.recording_dir, exist_ok=True)
app.mount("/recordings", StaticFiles(directory=settings.recording_dir), name="recordings")
os.makedirs(settings.cloned_voice_dir, exist_ok=True)

# 独立网站前端：启动 FastAPI 后可直接访问 http://localhost:8000/website/
website_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../website"))
if os.path.isdir(website_dir):
    app.mount("/website", StaticFiles(directory=website_dir, html=True), name="website")

# 业务路由
app.include_router(users.router, prefix=settings.api_prefix)
app.include_router(devices.router, prefix=settings.api_prefix)
app.include_router(scene_plans.router, prefix=settings.api_prefix)
app.include_router(ai.router, prefix=settings.api_prefix)
app.include_router(voice_clones.router, prefix=settings.api_prefix)
app.include_router(voice_clones.ai_voice_router, prefix=settings.api_prefix)
app.include_router(tasks.router, prefix=settings.api_prefix)
app.include_router(trigger.router, prefix=settings.api_prefix)
