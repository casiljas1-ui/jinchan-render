"""ORM 模型。

实体：
- User        用户
- Device      ESP32 实体挂件
- ScenePlan   退出方案（场景 + 联系人角色 + 理由 + 语音）
- VoiceFile   AI 生成的语音文件
- Task        一次触发产生的执行任务（状态机见 services/task_service.py）
"""
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    created_at = Column(DateTime, default=utcnow)

    devices = relationship("Device", back_populates="user")
    scene_plans = relationship("ScenePlan", back_populates="user")


class Device(Base):
    __tablename__ = "devices"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    device_key = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False, default="金婵挂件")
    status = Column(String, nullable=False, default="offline")  # online / offline
    last_seen = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow)

    user = relationship("User", back_populates="devices")


class ScenePlan(Base):
    __tablename__ = "scene_plans"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False, default="未命名方案")
    scene_type = Column(String, nullable=False)      # 聚会 / 会议 / 相亲 / ...
    contact_role = Column(String, nullable=False)    # 老板 / 同事 / 家人 / ...
    target_phone = Column(String, nullable=True)     # 被叫号码（用户自己的手机）
    reason = Column(Text, nullable=True)             # AI 生成的离开理由
    voice_file_id = Column(Integer, ForeignKey("voice_files.id"), nullable=True)
    status = Column(String, nullable=False, default="draft")  # draft / active / inactive
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    user = relationship("User", back_populates="scene_plans")
    voice_file = relationship("VoiceFile")


class VoiceFile(Base):
    __tablename__ = "voice_files"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    text = Column(Text, nullable=False)
    audio_path = Column(String, nullable=False)   # 相对 voice_dir 的文件名
    audio_url = Column(String, nullable=False)    # /voices/<filename>
    format = Column(String, nullable=False, default="wav")
    duration_ms = Column(Integer, nullable=False, default=0)
    provider = Column(String, nullable=False, default="mock")
    created_at = Column(DateTime, default=utcnow)


class VoiceProfile(Base):
    __tablename__ = "voice_profiles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    name = Column(String, nullable=False)
    provider_voice_id = Column(String, unique=True, index=True, nullable=False)
    provider_file_id = Column(String, nullable=True)
    provider = Column(String, nullable=False, default="minimax")
    source_filename = Column(String, nullable=False)
    recording_path = Column(String, nullable=False)
    recording_url = Column(String, nullable=False)
    duration_ms = Column(Integer, nullable=False, default=0)
    status = Column(String, nullable=False, default="ready")
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


# 保留旧类名，现有声音复刻接口无需改动；实际数据表统一为 voice_profiles。
ClonedVoice = VoiceProfile


class Scene(Base):
    __tablename__ = "scenes"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow)


class Script(Base):
    __tablename__ = "scripts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    title = Column(String, nullable=False)
    scene = Column(String, nullable=False)
    contact_role = Column(String, nullable=True)
    voice_id = Column(String, nullable=True)
    voice_name = Column(String, nullable=True)
    current_version_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    versions = relationship(
        "ScriptVersion",
        back_populates="script",
        cascade="all, delete-orphan",
        order_by="ScriptVersion.version_number",
    )


class ScriptVersion(Base):
    __tablename__ = "script_versions"

    id = Column(Integer, primary_key=True, index=True)
    script_id = Column(Integer, ForeignKey("scripts.id"), nullable=False, index=True)
    version_number = Column(Integer, nullable=False, default=1)
    content = Column(Text, nullable=False)
    source = Column(String, nullable=False, default="manual")
    created_at = Column(DateTime, default=utcnow)

    script = relationship("Script", back_populates="versions")


class VoiceGeneration(Base):
    __tablename__ = "voice_generations"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    voice_profile_id = Column(Integer, ForeignKey("voice_profiles.id"), nullable=True)
    script_version_id = Column(Integer, ForeignKey("script_versions.id"), nullable=True)
    scene_id = Column(Integer, ForeignKey("scenes.id"), nullable=True)
    voice_file_id = Column(Integer, ForeignKey("voice_files.id"), nullable=True)
    voice_name_snapshot = Column(String, nullable=True)
    script_snapshot = Column(Text, nullable=False)
    scene_snapshot = Column(String, nullable=True)
    audio_path = Column(String, nullable=False)
    duration_ms = Column(Integer, nullable=False, default=0)
    status = Column(String, nullable=False, default="success")
    created_at = Column(DateTime, default=utcnow)


class ExcuseHistory(Base):
    __tablename__ = "excuse_histories"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    scene_type = Column(String, nullable=False)
    contact_role = Column(String, nullable=False)
    voice_id = Column(String, nullable=True)
    voice_name = Column(String, nullable=True)
    text = Column(Text, nullable=False)
    created_at = Column(DateTime, default=utcnow)


class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=False)
    scene_plan_id = Column(Integer, ForeignKey("scene_plans.id"), nullable=False)
    status = Column(String, nullable=False, default="pending")
    # pending / executing / success / failed / cancelled
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    device = relationship("Device")
    scene_plan = relationship("ScenePlan")
