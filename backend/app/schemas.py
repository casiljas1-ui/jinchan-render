"""Pydantic 请求 / 响应模型。"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------- User ----------
class UserCreate(BaseModel):
    name: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    created_at: datetime


# ---------- Device ----------
class DeviceCreate(BaseModel):
    user_id: Optional[int] = None
    name: str = "金婵挂件"


class DeviceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: int
    device_key: str
    name: str
    status: str
    last_seen: Optional[datetime] = None


class DeviceHeartbeat(BaseModel):
    status: str = "online"


# ---------- ScenePlan ----------
class ScenePlanCreate(BaseModel):
    user_id: int
    name: str = "未命名方案"
    scene_type: str
    contact_role: str
    target_phone: Optional[str] = None
    reason: Optional[str] = None
    voice_file_id: Optional[int] = None


class ScenePlanUpdate(BaseModel):
    name: Optional[str] = None
    scene_type: Optional[str] = None
    contact_role: Optional[str] = None
    target_phone: Optional[str] = None
    reason: Optional[str] = None
    voice_file_id: Optional[int] = None


class ScenePlanOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: int
    name: str
    scene_type: str
    contact_role: str
    target_phone: Optional[str] = None
    reason: Optional[str] = None
    voice_file_id: Optional[int] = None
    status: str
    created_at: datetime


# ---------- AI ----------
class ExcuseRequest(BaseModel):
    scene_type: str
    contact_role: str
    tone: str = "自然"


class ExcuseResponse(BaseModel):
    reason: str
    provider: str


class VoiceRequest(BaseModel):
    text: str
    user_id: Optional[int] = None
    provider: Optional[str] = None
    voice_id: Optional[str] = None
    voice_name: Optional[str] = None
    scene_type: Optional[str] = None
    speed: Optional[float] = Field(default=None, ge=0.5, le=2.0)
    pitch: Optional[int] = Field(default=None, ge=-12, le=12)
    emotion: Optional[str] = None
    pause_sec: Optional[float] = Field(default=None, ge=0.05, le=2.0)
    telephone: bool = True


class VoiceResponse(BaseModel):
    voice_file_id: int
    audio_url: str
    duration_ms: int
    provider: str
    format: str
    sample_rate: int
    telephone: bool


class VoicePlanOut(BaseModel):
    id: int
    owner_name: str
    text: str
    audio_url: str
    duration_ms: int


class ClonedVoiceOut(BaseModel):
    id: int
    user_id: Optional[int] = None
    name: str
    provider_voice_id: str
    provider: str
    provider_file_id: Optional[str] = None
    recording_url: str
    duration_ms: int
    status: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ExcuseHistoryCreate(BaseModel):
    user_id: Optional[int] = None
    scene_type: str
    contact_role: str
    voice_id: Optional[str] = None
    voice_name: Optional[str] = None
    text: str


class ExcuseHistoryOut(ExcuseHistoryCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime


# ---------- Trigger / Task ----------
class TriggerRequest(BaseModel):
    device_key: str
    action: str = "trigger"  # trigger=三击触发 / cancel=长按取消


class TriggerResponse(BaseModel):
    task_id: int
    status: str
    target_phone: Optional[str] = None
    audio_url: Optional[str] = None
    reason: Optional[str] = None
    contact_role: Optional[str] = None
    scene_type: Optional[str] = None


class TaskStatusUpdate(BaseModel):
    status: str  # executing / success / failed / cancelled
    error: Optional[str] = None


class TaskOut(BaseModel):
    id: int
    device_id: int
    scene_plan_id: int
    status: str
    error: Optional[str] = None
    target_phone: Optional[str] = None
    audio_url: Optional[str] = None
    reason: Optional[str] = None
    contact_role: Optional[str] = None
    scene_type: Optional[str] = None
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
