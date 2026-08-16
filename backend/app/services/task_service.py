"""Task 状态机 + 对外序列化。

任务状态：pending -> executing -> success / failed
任意非终态可被长按取消 -> cancelled

与 ESP32 状态机（Idle / TriggerDetected / PendingCancel / Executing / Success / Failed）
对应的是固件侧按钮交互状态；后端 Task 只保留执行结果状态。
"""
from datetime import datetime, timezone

VALID_TRANSITIONS: dict[str, set[str]] = {
    "pending": {"executing", "cancelled"},
    "executing": {"success", "failed", "cancelled"},
    "success": set(),
    "failed": set(),
    "cancelled": set(),
}

TERMINAL = {"success", "failed", "cancelled"}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def advance(task, new_status: str, error: str | None = None):
    """执行一次合法状态迁移，非法迁移抛 ValueError。"""
    if new_status not in VALID_TRANSITIONS.get(task.status, set()):
        raise ValueError(f"非法状态迁移: {task.status} -> {new_status}")
    task.status = new_status
    task.error = error
    now = utcnow()
    if new_status == "executing":
        task.started_at = now
    if new_status in TERMINAL:
        task.completed_at = now
    return task


def serialize_task(task) -> dict:
    """把 Task 连同其方案 / 语音拼成执行端所需的一次性载荷。"""
    plan = task.scene_plan
    voice = plan.voice_file if plan else None
    return {
        "id": task.id,
        "device_id": task.device_id,
        "scene_plan_id": task.scene_plan_id,
        "status": task.status,
        "error": task.error,
        "target_phone": plan.target_phone if plan else None,
        "audio_url": voice.audio_url if voice else None,
        "reason": plan.reason if plan else None,
        "contact_role": plan.contact_role if plan else None,
        "scene_type": plan.scene_type if plan else None,
        "created_at": task.created_at,
        "started_at": task.started_at,
        "completed_at": task.completed_at,
    }
