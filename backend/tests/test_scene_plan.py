def _user_id(client, name="测试用户"):
    return client.post("/api/users", json={"name": name}).json()["id"]


def test_create_scene_plan(client):
    uid = _user_id(client)
    r = client.post(
        "/api/scene-plan",
        json={"user_id": uid, "scene_type": "聚会", "contact_role": "老板"},
    )
    assert r.status_code == 201
    assert r.json()["status"] == "draft"


def test_activate_requires_target_phone_and_reason(client):
    uid = _user_id(client)
    plan_id = client.post(
        "/api/scene-plan",
        json={"user_id": uid, "scene_type": "聚会", "contact_role": "老板"},
    ).json()["id"]

    # 缺被叫号码 + 缺理由 -> 激活被拒
    r = client.post(f"/api/scene-plan/{plan_id}/activate")
    assert r.status_code == 400

    # 补齐后激活成功
    client.patch(
        f"/api/scene-plan/{plan_id}",
        json={"target_phone": "13800138000", "reason": "公司有急事"},
    )
    r2 = client.post(f"/api/scene-plan/{plan_id}/activate")
    assert r2.status_code == 200
    assert r2.json()["status"] == "active"


def test_only_one_active_plan_per_user(client):
    uid = _user_id(client)
    ids = []
    for i in range(2):
        pid = client.post(
            "/api/scene-plan",
            json={
                "user_id": uid,
                "scene_type": "聚会",
                "contact_role": "老板",
                "target_phone": "13800138000",
                "reason": f"理由{i}",
            },
        ).json()["id"]
        ids.append(pid)
        client.post(f"/api/scene-plan/{pid}/activate")

    active = [p for p in client.get("/api/scene-plan", params={"user_id": uid}).json() if p["status"] == "active"]
    assert len(active) == 1
