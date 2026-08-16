# 金婵 UI 整合版

这是基于原始 `jinchan` 项目的独立整合副本。原项目不会被修改。

## 目录

- `app/`：Flutter 手机端与网页端界面
- `backend/`：FastAPI + SQLite 后端
- `android-executor/`、`esp32/`：原有设备执行代码

## 启动后端

在项目根目录运行：

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## 启动网页展示

先安装 Flutter SDK，然后运行：

```powershell
cd app
flutter create . --platforms=web
flutter pub get
flutter run -d chrome
```

网页默认连接 `http://localhost:8000`。

## 启动 Android

- Android 模拟器默认连接 `http://10.0.2.2:8000`
- 真机需要把 `app/lib/services/api_client.dart` 中的地址改为电脑局域网 IP，例如 `http://192.168.1.10:8000`

```powershell
cd app
flutter pub get
flutter run
```

## 已整合内容

- 金婵开机页与品牌 slogan
- 奶油色卡片、卡通图标、底部毛玻璃导航
- 首页、场景、触发记录、我的四个页面
- 设备、场景、任务数据接入现有后端接口
- 加载骨架、失败状态和重新加载入口
- 保留原有 AI 话术、联系人、设备绑定、Demo 测试页面

当前后端已有 AI 语音合成接口，但没有真正的声音克隆接口；“声音工坊”入口暂时复用现有 AI 页面，避免伪造不存在的后端能力。

## 复制到 D 盘

将整个 `jinchan-ui-integrated` 文件夹复制到：

`D:\ClaudeProjects\jinchan-ui-integrated`

不要把它覆盖回原始 `D:\ClaudeProjects\jinchan`。
