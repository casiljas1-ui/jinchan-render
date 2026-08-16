# 金婵轻量云端部署（Render）

该目录是独立部署副本，不会覆盖原始项目。它把金婵网页、FastAPI、DeepSeek、MiniMax 和 FFmpeg 放在同一个 Render Web Service 中。

## 部署

1. 将本目录中的所有文件上传到 GitHub 仓库根目录。不要只上传 ZIP 文件。
2. 登录 Render，选择 **New > Blueprint**。
3. 连接 GitHub 仓库。Render 会读取根目录的 `render.yaml`。
4. 创建服务时填写以下私密环境变量：
   - `DEEPSEEK_API_KEY`
   - `MINIMAX_API_KEY`
   - `MINIMAX_GROUP_ID`（账号不需要时可留空）
5. 完成部署后，直接打开 Render 提供的 `https://...onrender.com` 地址。

根网址会自动进入 `/website/latest.html`，不需要再手动输入页面路径。

## 数据保存方式

- 话术、方案和生成后的电话音频保存在访问者当前浏览器的 LocalStorage / IndexedDB。
- 不使用云数据库，不同浏览器之间不会共享数据。
- 清除浏览器网站数据后，本机内容会丢失。
- Render 免费实例的本地文件是临时文件；服务器休眠或重启后，后端 SQLite 和临时音频可能重置。
- 已生成电话音频会在生成后写入浏览器，因此正常使用不依赖云端长期保存文件。

## 免费实例提示

服务长时间无人访问后可能休眠。下一次打开时等待约一分钟即可自动恢复。

## 安全

API Key 只能填写在 Render 的 Environment 页面，不能写进网页、GitHub 或 Dockerfile。
