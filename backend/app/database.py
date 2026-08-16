"""SQLAlchemy 引擎与 Session。"""
from pathlib import Path
from shutil import copy2

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from .config import settings


def _prepare_sqlite_file(database_url: str) -> None:
    """创建数据库目录，并在首次切换新目录时保留旧数据库数据。"""
    prefix = "sqlite:///"
    if not database_url.startswith(prefix) or database_url.endswith(":memory:"):
        return
    raw_path = database_url[len(prefix):]
    database_path = Path(raw_path).resolve()
    database_path.parent.mkdir(parents=True, exist_ok=True)
    legacy_path = Path("./jinchan.db").resolve()
    if not database_path.exists() and legacy_path.exists() and legacy_path != database_path:
        copy2(legacy_path, database_path)


_prepare_sqlite_file(settings.database_url)

connect_args = {}
if settings.database_url.startswith("sqlite"):
    # SQLite 在多线程（uvicorn / pytest）下需要关闭同线程校验
    connect_args["check_same_thread"] = False

engine = create_engine(settings.database_url, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """FastAPI 依赖：提供数据库会话。"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
