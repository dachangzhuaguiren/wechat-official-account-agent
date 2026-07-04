# 将 GitHub Pages 接入 DeepSeek V4

## 架构

- `https://k8w98rr595-blip.github.io/wechat-official-account-agent/` 继续作为网页入口。
- Node 后端部署到 Render，负责保存 DeepSeek API Key 并调用模型。
- 网页只保存独立的 Agent 访问码，而且仅保存在当前浏览器会话中。
- DeepSeek API Key 不进入网页、不提交到 GitHub，也不要发送到聊天中。

## 模型分工

- 访谈、内容方向、局部改写：`deepseek-v4-flash`，关闭思考模式。
- 正文成稿、发布审核：`deepseek-v4-pro`，开启高强度思考模式。
- 所有请求使用 JSON Output，并在服务端执行结构校验和 HTML 清洗。

## 1. 部署后端

1. 登录 [Render](https://dashboard.render.com/)，选择 **New > Blueprint**。
2. 连接 GitHub 仓库 `k8w98rr595-blip/wechat-official-account-agent`。
3. Render 会读取仓库根目录的 `render.yaml`。
4. 在创建服务时填写两个 Secret：
   - `AGENT_API_KEY`：你的 DeepSeek API Key。
   - `AGENT_ACCESS_TOKEN`：另设一个至少 32 位的随机访问码，不要与 API Key 相同。
5. 等待健康检查通过，复制 Render 提供的 HTTPS 服务地址，例如 `https://wechat-official-account-agent-api.onrender.com`。

## 2. 连接 GitHub Pages

1. 打开 GitHub 仓库的 **Settings > Secrets and variables > Actions > Variables**。
2. 新建仓库变量：
   - Name：`AGENT_API_BASE_URL`
   - Value：上一步的 Render HTTPS 地址，末尾不要加 `/api`。
3. 在 **Actions > Deploy GitHub Pages** 中执行 **Run workflow**。
4. 部署完成后重新打开 Pages 网站。状态应显示 `DeepSeek V4`，第一次生成时输入 `AGENT_ACCESS_TOKEN`。

## 安全检查

- Pages 源码和浏览器网络请求中不得出现 `AGENT_API_KEY`。
- 非 GitHub Pages 来源会被后端 CORS 白名单拒绝。
- 未携带正确访问码的请求会返回 `401`。
- 真实模型模式如果没有配置访问码，会直接返回 `503`，不会开放匿名调用。
- 公网限流目前是单实例内存限流；如果未来多人使用，应改成账号登录和共享限流存储。
