"""ESP32 挂件触发入口。

三击  -> action="trigger"（默认）：为设备所属用户的激活方案创建 Task。
长按  -> action="cancel"：取消该设备最近一个未完成的任务。
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services.task_service import advance, serialize_task

router = APIRouter(prefix="/device", tags=["device-trigger"])


@router.post("/trigger", response_model=schemas.TriggerResponse)
def device_trigger(payload: schemas.TriggerRequest, db: Session = Depends(get_db)):
    device = (
        db.query(models.Device)
        .filter(models.Device.device_key == payload.device_key)
        .first()
    )
    if not device:
        raise HTTPException(status_code=404, detail="设备未绑定，device_key 无效")

    # 触达即在线
    device.status = "online"
    device.last_seen = models.utcnow()

    if payload.action == "cancel":
        task = (
            db.query(models.Task)
            .filter(
                models.Task.device_id == device.id,
                models.Task.status.in_(["pending", "executing"]),
            )
            .order_by(models.Task.created_at.desc())
            .first()
        )
        db.commit()
        if not task:
            return schemas.TriggerResponse(task_id=None, status="idle")
        advance(task, "cancelled")
        db.commit()
        return schemas.TriggerResponse(task_id=task.id, status="cancelled")

    plan = (
        db.query(models.ScenePlan)
        .filter(
            models.ScenePlan.user_id == device.user_id,
            models.ScenePlan.status == "active",
        )
        .order_by(models.ScenePlan.updated_at.desc())
        .first()
    )
    if not plan:
        db.commit()
        raise HTTPException(status_code=409, detail="没有已激活的退出方案，请先在 App 激活")

    task = models.Task(device_id=device.id, scene_plan_id=plan.id, status="pending")
    db.add(task)
    db.commit()
    db.refresh(task)

    data = serialize_task(task)
    return schemas.TriggerResponse(
        task_id=task.id,
        status=data["status"],
        target_phone=data["target_phone"],
        audio_url=data["audio_url"],
        reason=data["reason"],
        contact_role=data["contact_role"],
        scene_type=data["scene_type"],
    )
