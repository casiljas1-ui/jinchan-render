"""退出方案（ScenePlan）管理。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/scene-plan", tags=["scene-plan"])


@router.post("", response_model=schemas.ScenePlanOut, status_code=201)
def create_scene_plan(payload: schemas.ScenePlanCreate, db: Session = Depends(get_db)):
    if not db.get(models.User, payload.user_id):
        raise HTTPException(status_code=404, detail="用户不存在")
    plan = models.ScenePlan(
        user_id=payload.user_id,
        name=payload.name,
        scene_type=payload.scene_type,
        contact_role=payload.contact_role,
        target_phone=payload.target_phone,
        reason=payload.reason,
        voice_file_id=payload.voice_file_id,
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan


@router.get("", response_model=list[schemas.ScenePlanOut])
def list_scene_plans(user_id: int | None = None, db: Session = Depends(get_db)):
    q = db.query(models.ScenePlan)
    if user_id is not None:
        q = q.filter(models.ScenePlan.user_id == user_id)
    return q.order_by(models.ScenePlan.created_at.desc()).all()


@router.get("/{plan_id}", response_model=schemas.ScenePlanOut)
def get_scene_plan(plan_id: int, db: Session = Depends(get_db)):
    plan = db.get(models.ScenePlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="方案不存在")
    return plan


@router.patch("/{plan_id}", response_model=schemas.ScenePlanOut)
def update_scene_plan(plan_id: int, payload: schemas.ScenePlanUpdate, db: Session = Depends(get_db)):
    plan = db.get(models.ScenePlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="方案不存在")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(plan, field, value)
    db.commit()
    db.refresh(plan)
    return plan


@router.post("/{plan_id}/activate", response_model=schemas.ScenePlanOut)
def activate_scene_plan(plan_id: int, db: Session = Depends(get_db)):
    plan = db.get(models.ScenePlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="方案不存在")
    if not plan.target_phone:
        raise HTTPException(status_code=400, detail="请先填写被叫号码")
    if not plan.reason:
        raise HTTPException(status_code=400, detail="请先生成离开理由")
    # 同一用户同时只有一个激活方案
    db.query(models.ScenePlan).filter(
        models.ScenePlan.user_id == plan.user_id,
        models.ScenePlan.id != plan.id,
        models.ScenePlan.status == "active",
    ).update({"status": "inactive"})
    plan.status = "active"
    db.commit()
    db.refresh(plan)
    return plan


@router.post("/{plan_id}/deactivate", response_model=schemas.ScenePlanOut)
def deactivate_scene_plan(plan_id: int, db: Session = Depends(get_db)):
    plan = db.get(models.ScenePlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="方案不存在")
    plan.status = "inactive"
    db.commit()
    db.refresh(plan)
    return plan
