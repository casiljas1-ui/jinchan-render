"""设备（ESP32 挂件）管理。"""
import secrets

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/devices", tags=["devices"])

_DEFAULT_USER_NAME = "默认用户"


def _resolve_user(db: Session, user_id: int | None) -> models.User:
    """未指定用户时，落到「默认用户」，让 Demo 无需先建用户即可绑设备。"""
    if user_id is not None:
        user = db.get(models.User, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")
        return user
    user = db.query(models.User).filter(models.User.name == _DEFAULT_USER_NAME).first()
    if not user:
        user = models.User(name=_DEFAULT_USER_NAME)
        db.add(user)
        db.flush()
    return user


@router.post("", response_model=schemas.DeviceOut, status_code=201)
def create_device(payload: schemas.DeviceCreate, db: Session = Depends(get_db)):
    user = _resolve_user(db, payload.user_id)
    device = models.Device(
        user_id=user.id,
        device_key=secrets.token_hex(16),
        name=payload.name,
        status="offline",
    )
    db.add(device)
    db.commit()
    db.refresh(device)
    return device


@router.get("", response_model=list[schemas.DeviceOut])
def list_devices(user_id: int | None = None, db: Session = Depends(get_db)):
    q = db.query(models.Device)
    if user_id is not None:
        q = q.filter(models.Device.user_id == user_id)
    return q.all()


@router.get("/{device_id}", response_model=schemas.DeviceOut)
def get_device(device_id: int, db: Session = Depends(get_db)):
    device = db.get(models.Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="设备不存在")
    return device


@router.post("/{device_id}/heartbeat", response_model=schemas.DeviceOut)
def heartbeat(device_id: int, payload: schemas.DeviceHeartbeat, db: Session = Depends(get_db)):
    device = db.get(models.Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="设备不存在")
    device.status = payload.status
    device.last_seen = models.utcnow()
    db.commit()
    db.refresh(device)
    return device
