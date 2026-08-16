# 金婵 MiniMax 真人声音复刻与电话版语音

## 1. Windows 准备

1. 安装 Python 3.11 或更高版本。
2. 安装 FFmpeg，并确认 PowerShell 中执行 `ffmpeg -version` 能看到版本信息。
3. 如果不希望加入 PATH，可在 `backend/.env` 中设置 `FFMPEG_PATH=C:\path\to\ffmpeg.exe`。

## 2. 后端配置

在 `backend` 目录复制 `.env.example` 为 `.env`，至少填写：

```env
AI_PROVIDER=minimax
MINIMAX_API_KEY=你的真实密钥
MINIMAX_TTS_MODEL=speech-2.8-hd
MINIMAX_TEXT_MODEL=MiniMax-M2.7
VOICE_DIR=./storage/audio/calls/generated
RECORDING_DIR=./storage/audio/voices/originals
CLONED_VOICE_DIR=./storage/audio/voices/cloned
```

密钥仅由 FastAPI 后端读取，网页不会获得或保存密钥。`.env` 已被 `.gitignore` 排除。

## 3. 启动

```powershell
cd C:\Users\Grace\Documents\Codex\jinchan-ui-integrated\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

浏览器访问 `http://localhost:8000/website/`。

## 4. 真人复刻流程

1. 打开“声音工坊”并点击“克隆新声音”。
2. 确认声音本人授权。
3. 录制或上传 10 秒至 5 分钟、最大 20MB 的 MP3/M4A/WAV。
4. 输入音色名称并开始复刻。
5. 成功后新音色会自动加入本地数据库与音色列表，并自动成为当前音色。
6. 选择或输入话术，调整语速和句间停顿，生成电话版语音。

## 5. 输出约束

MiniMax 返回的分句 MP3、转换后的分句 WAV、静音、拼接清单和 32kHz 原始拼接文件全部位于自动清理的临时目录。只有最终 8000Hz、单声道、PCM 16-bit 的电话版 WAV 会保存到 `VOICE_DIR`，并通过 `/voices/voice_<uuid>.wav` 访问。

## 6. 测试

测试不会调用 MiniMax，也不会消耗额度：

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q
```

测试包含接口 mock、中文分句、逐句 TTS、静音拼接、电话滤镜、最终 WAV 规格、临时文件清理和静态音频下载。
