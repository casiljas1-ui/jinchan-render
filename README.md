# 金婵 AI 社交自由助手 · JinChan AI Social Freedom Assistant

> 让用户在社交场景中拥有「自然离开」的选择权。
> 用户提前配置退出方案 → 三击实体挂件 → 无需拿手机 → 获得一通真实电话 → 播放预生成 AI 语音。

这是 Hackathon MVP Demo（四组件），**不是商业最终方案**。

---

## 架构

```
┌──────────┐   三击/长按     ┌────────────┐   HTTP   ┌──────────────┐
│  ESP32    │ ─────────────▶ │  Backend    │ ◀──────▶ │  Flutter App  │
│  挂件      │   /device/     │  FastAPI    │          │  配置/激活方案 │
└──────────┘   trigger       │  + SQLite   │          └──────────────┘
                             │             │
                             │  Task(pending)│
                             └──────┬──────┘
                                    │ 轮询 /task?status=pending
                             ┌──────▼─────────┐   自动拨号+播语音
                             │ Android 执行端  │ ───────────────▶ 用户手机(被叫)
                             └────────────────┘
```

## 目录结构

```
jinchan/
├── backend/            Python FastAPI + SQLite（含 AI Provider 接口 + 测试）
├── app/                Flutter App（6 页面）
├── esp32/              ESP32 挂件固件（Arduino）
├── android-executor/   Android 执行端（备用机拨号+播音）
├── scripts/            demo_e2e.py 端到端仿真脚本
└── docs/               PHASE0_SPIKE.md 电话音频链路验证方案
```

## 快速开始（后端 + 全链路仿真）

```powershell
# 1) 后端（已建好 venv）
cd backend
.\.venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# 2) 另开终端，跑全链路仿真（无需 ESP32 / 真机）
python scripts\demo_e2e.py
```

仿真脚本会依次完成：建用户 → 建设备 → AI 理由 → AI 语音 → 建方案 → 激活 → 三击触发 → 取任务 → 下载语音校验 → 成功。

### 运行测试

```powershell
cd backend
.\.venv\Scripts\python -m pytest -q      # 11 passed
```

## 各组件启动

| 组件 | 技术 | 入口 / 说明 |
|------|------|-------------|
| Backend | FastAPI + SQLite | `backend/app/main.py`，`uvicorn app.main:app --port 8000` |
| Flutter App | Flutter | `app/lib/main.dart`，需 Flutter SDK，`flutter run` |
| ESP32 | Arduino | `esp32/jinchan_pendant/jinchan_pendant.ino`，先改 `config.h` |
| Android 执行端 | Kotlin | `android-executor/`，接入 Android Studio 真机运行 |

## 核心 API（PRD 规定）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/device/trigger` | 三击触发 / 长按取消（`action=trigger|cancel`） |
| POST | `/api/scene-plan` | 创建退出方案 |
| POST | `/api/ai/excuse` | AI 生成离开理由 |
| POST | `/api/ai/voice` | AI 生成语音（TTS） |
| GET | `/api/task/{id}` | 查询任务（执行端轮询） |

辅助接口：`/api/users`、`/api/devices`、`/api/scene-plan/{id}/activate`、
`/api/task`（列表，支持 `?status=pending`）、`/api/task/{id}/status`（回传执行状态）。

## AI Provider 抽象

`backend/app/services/ai_provider.py` 定义统一接口，切换厂商只改配置 `AI_PROVIDER`：

- `mock`（默认，离线可跑，语音为合成提示音占位）
- `openai` / `deepseek` / `minimax`（真实 TTS，需填对应 API Key，见 `backend/.env.example`）

## ⚠️ 交付前必读

**Phase 0 电话音频链路是最大风险**：执行端用 `STREAM_VOICE_CALL` 在通话中播音，
不同 Android 机型行为不一致。真机演示前必须先按 [docs/PHASE0_SPIKE.md](docs/PHASE0_SPIKE.md)
验证「B 能听到 A 播放的声音」，否则请暂停并切换方案（ConnectionService / 物理兜底）。
