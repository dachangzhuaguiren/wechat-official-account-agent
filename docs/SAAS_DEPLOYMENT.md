# SaaS 后端部署

## 已实现范围

- 邮箱密码注册、登录、退出和 30 天会话。
- 企业组织、`owner/admin/editor/reviewer` 四级权限和成员名额。
- SQLite 云端工作区、深层 Schema 校验与乐观版本锁。
- 14 天试用、¥199 团队版、¥499 成长版及成稿额度。
- 服务端订单定价、幂等订单、退款申请与管理员处理状态机。
- 服务端 DeepSeek 调用、Token/模型成本记录和平台管理指标。
- 租户归属校验、安全审计日志、登录/来源/全局限流。

## 运行要求

需要 Node.js 22.5 或更高版本。单实例部署必须挂载持久化磁盘到 `/data`；Docker 镜像默认把 SQLite 写入 `/data/saas.sqlite`。Railway Volume 应挂载到 `/data`，镜像会在启动时修正该目录权限，随后以非 root 用户运行应用。

```dotenv
SAAS_ENABLED=1
SAAS_DATABASE_PATH=/data/saas.sqlite
SAAS_SESSION_DAYS=30
SAAS_BOOTSTRAP_ADMIN_EMAIL=admin@example.com
SAAS_BOOTSTRAP_ADMIN_TOKEN=至少32字符的单次初始化随机值
PUBLIC_API_BASE_URL=https://api.example.com

AGENT_PROVIDER_MODE=openai-compatible
AGENT_BASE_URL=https://api.deepseek.com
AGENT_API_KEY=部署平台Secret中的DeepSeek密钥
AGENT_MODEL=deepseek-v4-flash
AGENT_MODEL_QUALITY=deepseek-v4-pro
ALLOWED_ORIGINS=https://k8w98rr595-blip.github.io
TRUST_PROXY=1
AUDIT_LOG_KEY=至少32字符随机值
```

只有注册邮箱与 `SAAS_BOOTSTRAP_ADMIN_EMAIL` 匹配、且注册时提交的初始化码与 `SAAS_BOOTSTRAP_ADMIN_TOKEN` 一致，账号才会成为平台管理员。初始化码至少 32 字符。首次管理员注册完成后应同时清空这两个变量并重启服务。

## GitHub Pages 连接

后端 HTTPS 地址部署完成后，在 GitHub 仓库 Actions variables 中设置：

```text
AGENT_API_BASE_URL=https://你的后端域名
SAAS_ENABLED=1
```

重新运行 `Deploy GitHub Pages` 后，前端会进入企业登录模式，并把所有 Agent 请求和云端同步请求发送到后端。DeepSeek Key 不会进入 Pages 构建产物。

## 支付边界

当前订单提供的是安全的“人工确认支付”适配器：用户创建订单，平台管理员核对实际到账后确认，套餐随即生效；退款由用户申请、管理员批准或拒绝。数据库状态迁移、价格校验、归属校验和幂等已实现。

接入微信支付后，必须用微信支付回调签名和平台订单号替换人工确认，退款批准也必须在微信退款 API 成功后再更新本地状态。不得把前端回传的金额、支付状态或退款状态作为可信数据。

## 当前部署限制

- SQLite 方案只支持单个后端实例；多实例前必须迁移 PostgreSQL，并使用共享限流和集中日志。
- 尚未实现邮箱验证、密码找回、MFA和会话设备管理。
- 会话 Token 保存在当前标签页 `sessionStorage`；严格 CSP 可降低但不能消除 XSS 窃取风险。
- 真实微信支付、自动退款和电子发票需要商户号、证书及回调域名，不能在缺少平台凭据时启用。
