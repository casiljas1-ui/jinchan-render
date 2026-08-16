"""pytest 公共夹具：在导入 app 前注入隔离的测试环境。"""
import os
import tempfile

# 必须在 import app 之前设置，pydantic-settings 在导入时读取环境变量
_TMP = tempfile.mkdtemp(prefix="jinchan_test_")
_db_path = os.path.join(_TMP, "test.db").replace("\\", "/")
os.environ["DATABASE_URL"] = f"sqlite:///{_db_path}"
os.environ["AI_PROVIDER"] = "mock"
os.environ["VOICE_DIR"] = os.path.join(_TMP, "voices")
os.environ["RECORDING_DIR"] = os.path.join(_TMP, "recordings")
os.environ["MINIMAX_API_KEY"] = "test-key-never-sent"

import pytest
from fastapi.testclient import TestClient

from app.database import Base, engine
from app.config import settings
from app.main import app


@pytest.fixture(autouse=True)
def _fresh_db():
    """每个用例前重建表，保证隔离。"""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    for directory in (settings.voice_dir, settings.recording_dir):
        os.makedirs(directory, exist_ok=True)
        for filename in os.listdir(directory):
            path = os.path.join(directory, filename)
            if os.path.isfile(path):
                os.unlink(path)
    yield


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c
