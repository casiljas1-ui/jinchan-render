"""本地 SQLite 首次启动初始化与旧数据兼容迁移。"""
from datetime import datetime
from sqlalchemy import inspect, text

from . import models
from .database import SessionLocal, engine


DEFAULT_SCENES = (
    ("聚餐脱身", "聚会或聚餐中需要自然离开"),
    ("商务离场", "会议或商务活动中需要及时离开"),
    ("相亲结束", "需要礼貌结束当前见面"),
    ("自定义场景", "由用户创建的专属离场场景"),
)


def _as_datetime(value):
    if isinstance(value, datetime) or value is None:
        return value
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


def _migrate_legacy_cloned_voices(db) -> None:
    tables = set(inspect(engine).get_table_names())
    if "cloned_voices" not in tables or db.query(models.VoiceProfile.id).first():
        return
    rows = db.execute(text("SELECT * FROM cloned_voices ORDER BY id")).mappings()
    for row in rows:
        db.add(models.VoiceProfile(
            user_id=row.get("user_id"),
            name=row["name"],
            provider_voice_id=row["provider_voice_id"],
            provider_file_id=row.get("provider_file_id"),
            provider=row.get("provider") or "minimax",
            source_filename=row["source_filename"],
            recording_path=row["recording_path"],
            recording_url=row["recording_url"],
            duration_ms=row.get("duration_ms") or 0,
            status=row.get("status") or "ready",
            created_at=_as_datetime(row.get("created_at")),
        ))


def _migrate_legacy_histories(db) -> None:
    tables = set(inspect(engine).get_table_names())
    if "excuse_histories" not in tables or db.query(models.Script.id).first():
        return
    rows = db.execute(text("SELECT * FROM excuse_histories ORDER BY id")).mappings()
    for row in rows:
        script = models.Script(
            user_id=row.get("user_id"),
            title=f"{row['scene_type']}话术",
            scene=row["scene_type"],
            contact_role=row["contact_role"],
            voice_id=row.get("voice_id"),
            voice_name=row.get("voice_name"),
            created_at=_as_datetime(row.get("created_at")),
        )
        db.add(script)
        db.flush()
        version = models.ScriptVersion(
            script_id=script.id,
            version_number=1,
            content=row["text"],
            source="legacy",
            created_at=_as_datetime(row.get("created_at")),
        )
        db.add(version)
        db.flush()
        script.current_version_id = version.id


def initialize_local_data() -> None:
    """创建默认用户/场景，并把旧表安全复制到新结构。"""
    with SessionLocal() as db:
        if not db.query(models.User.id).first():
            db.add(models.User(name="用户1"))
        for name, description in DEFAULT_SCENES:
            if not db.query(models.Scene.id).filter(models.Scene.name == name).first():
                db.add(models.Scene(name=name, description=description))
        db.flush()
        _migrate_legacy_cloned_voices(db)
        _migrate_legacy_histories(db)
        db.commit()
