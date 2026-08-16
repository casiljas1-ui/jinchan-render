"""任务查询与状态回传（供 App 与 Android 执行端轮询）。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services.task_service import advance, serialize_task

router = APIRouter(prefix="/task", tags=["task"])


@router.get("", response_model=list[schemas.TaskOut])
def list_tasks(
    status: str | None = None,
    device_id: int | None = None,
    db: Session = Depends(get_db),
):
    q = db.query(models.Task)
    if status:
        q = q.filter(models.Task.status == status)
    if device_id is not None:
        q = q.filter(models.Task.device_id == device_id)
    return [serialize_task(t) for t in q.order_by(models.Task.created_at.desc()).limit(100).all()]


@router.get("/{task_id}", response_model=schemas.TaskOut)
def get_task(task_id: int, db: Session = Depends(get_db)):
    task = db.get(models.Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    return serialize_task(task)


@router.post("/{task_id}/status", response_model=schemas.TaskOut)
def update_task_status(task_id: int, payload: schemas.TaskStatusUpdate, db: Session = Depends(get_db)):
    task = db.get(models.Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    try:
        advance(task, payload.status, payload.error)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    db.commit()
    db.refresh(task)
    return serialize_task(task)
