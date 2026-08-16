"""端到端 Demo 链路：建方案 -> 激活 -> 三击触发 -> 取任务 -> 执行 -> 成功。"""


def _setup_active_plan(client):
    uid = client.post("/api/users", json={"name": "小美"}).json()["id"]
    dev = client.post("/api/devices", json={"user_id": uid, "name": "挂件A"}).json()
    excuse = client.post(
        "/api/ai/excuse", json={"scene_type": "聚会", "contact_role": "老板"}
    ).json()["reason"]
    voice = client.post("/api/ai/voice", json={"text": excuse, "user_id": uid}).json()
    plan = client.post(
        "/api/scene-plan",
        json={
            "user_id": uid,
            "name": "临时离场",
            "scene_type": "聚会",
            "contact_role": "老板",
            "target_phone": "13800138000",
            "reason": excuse,
            "voice_file_id": voice["voice_file_id"],
        },
    ).json()
    client.post(f"/api/scene-plan/{plan['id']}/activate")
    return dev, plan, voice


def test_full_demo_flow(client):
    dev, plan, voice = _setup_active_plan(client)

    # 1. 三击触发
    r = client.post("/api/device/trigger", json={"device_key": dev["device_key"]})
    assert r.status_code == 200
    trig = r.json()
    assert trig["status"] == "pending"
    task_id = trig["task_id"]
    assert trig["target_phone"] == "13800138000"
    assert trig["audio_url"] == voice["audio_url"]
    assert trig["contact_role"] == "老板"

    # 2. 执行端（Android）取任务
    r2 = client.get(f"/api/task/{task_id}")
    assert r2.status_code == 200
    assert r2.json()["status"] == "pending"

    # 3. 执行端回传 executing -> success
    client.post(f"/api/task/{task_id}/status", json={"status": "executing"})
    r4 = client.post(f"/api/task/{task_id}/status", json={"status": "success"})
    assert r4.status_code == 200
    assert r4.json()["status"] == "success"
    assert r4.json()["completed_at"] is not None

    # 4. 终态不可再迁移
    r5 = client.post(f"/api/task/{task_id}/status", json={"status": "failed"})
    assert r5.status_code == 409


def test_executor_polls_pending_tasks(client):
    dev, _, _ = _setup_active_plan(client)
    client.post("/api/device/trigger", json={"device_key": dev["device_key"]})
    r = client.get("/api/task", params={"status": "pending"})
    assert r.status_code == 200
    assert len(r.json()) == 1


def test_trigger_unknown_device(client):
    r = client.post("/api/device/trigger", json={"device_key": "not-exist"})
    assert r.status_code == 404


def test_trigger_no_active_plan(client):
    uid = client.post("/api/users", json={"name": "无方案"}).json()["id"]
    dev = client.post("/api/devices", json={"user_id": uid}).json()
    r = client.post("/api/device/trigger", json={"device_key": dev["device_key"]})
    assert r.status_code == 409


def test_long_press_cancel(client):
    dev, _, _ = _setup_active_plan(client)
    trig = client.post("/api/device/trigger", json={"device_key": dev["device_key"]}).json()
    task_id = trig["task_id"]

    r = client.post(
        "/api/device/trigger",
        json={"device_key": dev["device_key"], "action": "cancel"},
    )
    assert r.status_code == 200
    assert r.json()["task_id"] == task_id
    assert r.json()["status"] == "cancelled"

    # 任务确实被取消
    r2 = client.get(f"/api/task/{task_id}")
    assert r2.json()["status"] == "cancelled"
