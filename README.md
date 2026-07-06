# 公众号写作 Agent

把一个粗浅想法逐步整理成可编辑的微信公众号文章。Agent 会先追问关键信息，再生成内容方向、正文草稿，并支持局部改写、发布检查和复制到公众号编辑器。

## 项目结构

```text
公众号agent/
├─ frontend/
│  ├─ public/          # 页面与交互逻辑
│  └─ styles/          # 全局样式
├─ backend/
│  ├─ server.mjs       # HTTP 服务与 API
│  └─ lib/             # Agent 编排及模型适配器
├─ tests/              # 自动化测试
├─ scripts/            # 构建检查
├─ docs/               # 产品说明与模型接入文档
└─ .github/workflows/  # GitHub Pages 自动部署
```

## 本地运行

需要 Node.js 20 或更高版本。

```bash
npm test
npm run build
npm start
```

打开 `http://127.0.0.1:3000`。默认使用 Mock 模式，不需要 API 密钥。

## 接入真实模型

复制 `.env.example` 为 `.env.local`，然后设置：

```dotenv
AGENT_PROVIDER_MODE=openai-compatible
AGENT_BASE_URL=https://api.deepseek.com
AGENT_API_KEY=你的服务端密钥
AGENT_MODEL=deepseek-v4-flash
AGENT_MODEL_QUALITY=deepseek-v4-pro
AGENT_THINKING_MODE=operation-based
AGENT_ACCESS_TOKEN=另设的随机访问码
```

密钥只应配置在服务端或托管平台的环境变量中，不能写入前端或提交到 GitHub。详细说明见 [模型接入教程](docs/lessons/0001-connect-an-openai-compatible-model.html)。

## GitHub Pages 部署

现有 GitHub Pages 地址会直接连接 DeepSeek V4。第一次使用真实 AI 时，网页会要求输入 DeepSeek API Key；Key 仅保存在当前页面的 JavaScript 内存中，刷新或关闭页面后自动清除，不会写入 Web Storage、GitHub 或 IndexedDB。详见 [DeepSeek V4 部署说明](docs/deploy-deepseek-v4.md)。

推送到 GitHub 仓库的 `main` 分支后，`Deploy GitHub Pages` 工作流会自动测试、构建并发布网站。项目站点默认地址为：

```text
https://<GitHub用户名>.github.io/<仓库名>/
```

GitHub Pages 是静态托管：未配置 `AGENT_API_BASE_URL` 时，由浏览器使用用户临时输入的 Key 直接调用 DeepSeek；配置该变量后，也可以切换到独立部署的 `backend/`。任何 Key 都不能写入仓库或构建产物。

## 数据说明

- 草稿和品牌信息保存在当前浏览器的 IndexedDB 中。
- 备份导出默认建议使用密码加密；加密备份使用 PBKDF2-SHA-256 与 AES-256-GCM。
- 导入备份会执行深层字段白名单、数量、长度、ID、颜色和图片 Data URL 校验。
- “清除本地数据”会删除当前浏览器内的工作区、图片和临时访问码。
- 个人模式不向服务端保存文章或账户；SaaS 模式会把企业账户、成员、订阅和工作区保存在服务端 SQLite 数据库。
- 公网 API 将认证失败限流与模型调用额度分开；默认每来源每分钟 30 次模型请求。

## SaaS 企业模式

设置 `SAAS_ENABLED=1` 后，Node 后端会启用企业 SaaS 能力：账号登录、企业组织、四级成员权限、SQLite 云端同步、订阅与成稿额度、订单退款状态机、服务端 DeepSeek 调用、管理后台及 Token/成本监控。前端会自动切换为企业登录和云端工作区界面。

主套餐为 ¥199/月，包含 60 篇成稿和 3 名成员。当前支付适配器采用管理员核对到账后确认的方式；真实微信支付仍需商户凭据和签名回调。部署说明见 [SaaS 后端部署](docs/SAAS_DEPLOYMENT.md)。

后端 API 的身份、权限、信任边界、已修复问题和部署检查见 [后端安全边界表](docs/BACKEND_SECURITY_BOUNDARIES.md)。
