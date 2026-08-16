"""MiniMax 真人音色上传与克隆适配器。"""

from __future__ import annotations

from pathlib import Path

import httpx

from ..config import settings


BASE_URL = "https://api.minimaxi.com/v1"


class MiniMaxCloneError(RuntimeError):
    """不包含密钥或完整上游响应的安全错误。"""


def _headers(api_key: str | None = None) -> dict[str, str]:
    key = api_key or settings.minimax_api_key
    if not key:
        raise MiniMaxCloneError("未配置 MINIMAX_API_KEY。")
    return {"Authorization": f"Bearer {key}"}


def _params() -> dict[str, str]:
    return {"GroupId": settings.minimax_group_id} if settings.minimax_group_id else {}


def _safe_http_error(response: httpx.Response, action: str) -> MiniMaxCloneError:
    if response.status_code == 401:
        return MiniMaxCloneError(f"MiniMax {action}鉴权失败，请检查后端 API Key。")
    if response.status_code == 402:
        return MiniMaxCloneError(f"MiniMax {action}余额不足或计费未开通。")
    if response.status_code == 413:
        return MiniMaxCloneError("MiniMax 拒绝了参考录音：文件过大。")
    if response.status_code == 429:
        return MiniMaxCloneError(f"MiniMax {action}请求过于频繁，请稍后重试。")
    return MiniMaxCloneError(f"MiniMax {action}失败（HTTP {response.status_code}）。")


def _read_json(response: httpx.Response, action: str) -> dict:
    if not response.is_success:
        raise _safe_http_error(response, action)
    try:
        data = response.json()
    except ValueError as error:
        raise MiniMaxCloneError(f"MiniMax {action}返回了无法解析的数据。") from error
    base = data.get("base_resp") or {}
    code = base.get("status_code", 0)
    if code not in (0, None):
        raise MiniMaxCloneError(f"MiniMax {action}失败（代码 {code}）。")
    return data


def upload_clone_sample(path: Path, api_key: str | None = None) -> str:
    try:
        with path.open("rb") as file_obj:
            response = httpx.post(
                f"{BASE_URL}/files/upload",
                params=_params(),
                headers=_headers(api_key),
                data={"purpose": "voice_clone"},
                files={"file": (path.name, file_obj, "audio/wav")},
                timeout=120,
            )
    except httpx.RequestError as error:
        raise MiniMaxCloneError("无法连接 MiniMax 文件上传服务，请检查网络后重试。") from error
    data = _read_json(response, "参考录音上传")
    file_id = (data.get("file") or {}).get("file_id") or data.get("file_id")
    if file_id is None:
        raise MiniMaxCloneError("MiniMax 未返回参考录音 file_id。")
    return str(file_id)


def create_clone(file_id: str, voice_id: str, preview_text: str | None = None, api_key: str | None = None) -> dict:
    text = (preview_text or "你好，我是金婵。需要的时候，我会用这个声音给你打来电话。").strip()
    try:
        response = httpx.post(
            f"{BASE_URL}/voice_clone",
            params=_params(),
            headers={**_headers(api_key), "Content-Type": "application/json"},
            json={
                "file_id": int(file_id) if file_id.isdigit() else file_id,
                "voice_id": voice_id,
                "text": text[:500],
                "model": settings.minimax_tts_model,
                "need_noise_reduction": True,
                "need_volume_normalization": True,
            },
            timeout=180,
        )
    except httpx.RequestError as error:
        raise MiniMaxCloneError("无法连接 MiniMax 声音复刻服务，请检查网络后重试。") from error
    return _read_json(response, "声音复刻")
