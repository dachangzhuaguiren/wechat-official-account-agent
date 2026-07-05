# 后端安全边界与 API 权限表

审查日期：2026-07-05  
适用提交：本文件所在提交  
生产入口：`https://k8w98rr595-blip.github.io/wechat-official-account-agent/`

## 1. 架构与信任边界

当前有两种互斥的模型调用模式：

1. **GitHub Pages 生产模式（当前启用）**：浏览器要求使用者输入自己的 DeepSeek API Key，Key 仅保存在页面 JavaScript 内存中，浏览器直接请求 `https://api.deepseek.com/chat/completions`。
2. **独立后端模式（可选）**：浏览器使用共享 `AGENT_ACCESS_TOKEN` 调用 Node 后端，后端再用服务端 `AGENT_API_KEY` 请求模型供应商。

| 边界 | 不可信输入 | 可信配置 | 主要控制 |
|---|---|---|---|
| 浏览器 → GitHub Pages | URL、导入备份、编辑内容、图片描述 | 仓库发布产物 | CSP、HTML 清洗、固定静态资源路径 |
| 浏览器 → DeepSeek | 所有文章与提示词内容 | 使用者临时输入的 Key、固定官方 API 地址 | Key 仅内存保存、固定模型、输入/输出结构与长度校验、响应大小与超时限制 |
| 客户端 → Node API | Origin、Host、转发头、Bearer Token、JSON Body | 服务端环境变量 | CORS 精确 Origin、Bearer Token、全局与来源限流、JSON 媒体类型和大小限制 |
| Node API → 模型供应商 | 经校验的业务字段、模型返回 | API Key、Base URL、模型名 | HTTPS/HTTP URL 白名单、超时、最大输出 token、2MB 响应上限、深层模型结果校验 |
| 浏览器 → IndexedDB | 导入的工作区和模型生成内容 | 当前浏览器同源存储 | HTML DOM 清洗、备份 25MB 上限；不保存 API Key |

## 2. 身份与能力

| 身份 | 认证方式 | 能力 | 数据所有权 |
|---|---|---|---|
| 匿名访问者 | 无 | 读取静态资源、读取最小健康状态 | 无服务端记录 |
| Pages 使用者 | 自己的 DeepSeek API Key，由 DeepSeek 验证 | 使用自己的额度执行五项 Agent 操作 | 草稿仅在自己的浏览器 IndexedDB |
| 后端 Agent 客户端 | `Authorization: Bearer <AGENT_ACCESS_TOKEN>`，Token 至少 32 字符 | `agent:invoke`，可调用五项 Agent 操作 | 后端不保存文章或用户记录，因此没有跨用户记录权限 |
| 本地开发者 | 仅无代理、回环地址和 localhost Host 可使用无认证例外 | 本机调试 Agent | 仅本机进程 |
| 仓库/部署管理员 | GitHub 与托管平台权限 | 修改代码、公开配置、服务端 Secret | 负责 Secret 轮换和部署审计 |

当前后端是无状态个人工具，不具备用户账号、角色、租户或资源 ID。共享 Token 持有者拥有全部 `agent:invoke` 能力；如果未来多人共用后端，必须先增加真实身份、按用户配额、Token 撤销和租户隔离，不能把共享 Token 当作多用户授权系统。

## 3. API 权限边界表

| 路径 / 方法 | 访问能力 | 认证与授权 | 输入控制 | 外部副作用 | 响应与审计 |
|---|---|---|---|---|---|
| `GET /api/health` | `health:read`（公开） | 无；默认只返回 `{ok:true}` | 无业务输入；CORS 仍按 Origin 执行 | 无 | `no-store`，不暴露模型或 Secret 状态；仅显式开启 `EXPOSE_HEALTH_DETAILS=1` 才返回详情 |
| `OPTIONS /api/*` | CORS 预检（公开） | Origin 必须是精确同源或在 `ALLOWED_ORIGINS` | 只允许 `GET, POST, OPTIONS` 与 `authorization, content-type` | 无 | 204，缓存 600 秒 |
| `POST /api/agent/interview` | `agent:invoke` | 共享 Bearer Token；真实模型无 Token 时拒绝。无认证例外仅限本机回环 | `campaignType` 枚举；idea ≤ 4000；回答 ≤ 8，每项 ID/文本受限；品牌字段白名单 | 调用 Flash；最多 2000 输出 tokens；最多一次结构修复重试 | 返回单问题或完整简报；失败只记录 requestId、固定操作名和错误代码，不记录正文或 Key |
| `POST /api/agent/directions` | `agent:invoke` | 同上 | 顶层字段白名单；简报所有字段、字符串和数组深层校验 | 调用 Flash；最多 3000 输出 tokens | 必须返回恰好 3 个方向，每项 ID、标题、角度、提纲均校验 |
| `POST /api/agent/draft` | `agent:invoke` | 同上 | 简报、方向和品牌深层校验；图片 ≤ 20，仅接收名称、描述和 MIME，不接收图片二进制 | 调用 Pro；高强度思考；最多 12000 输出 tokens | HTML ≤ 200KB，并移除未知标签、脚本、样式和危险链接属性 |
| `POST /api/agent/rewrite` | `agent:invoke` | 同上 | 原文 ≤ 12000；指令 ≤ 1000；品牌/简报字段白名单 | 调用 Flash；最多 3000 输出 tokens | replacement 必须是 1–20000 字符字符串 |
| `POST /api/agent/audit` | `agent:invoke` | 同上 | 正文 ≤ 50000；简报和品牌深层校验 | 调用 Pro；高强度思考；最多 5000 输出 tokens | issues ≤ 50；severity 只允许 `blocking` 或 `warning`，防止绕过发布阻断 |
| 其他 `/api/*` 或错误方法 | 无 | 默认拒绝 | 路由和方法固定白名单 | 无 | 404，不暴露内部路由 |
| 固定静态资源 `GET /` 等 | `static:read`（公开） | 无 | `Map` 固定路径，不接受文件路径参数 | 读取仓库内固定文件 | CSP、`nosniff`、`no-referrer`、禁用 framing/权限能力 |

所有 Agent POST 请求还统一执行：1MB 请求体上限、`application/json`/`+json` 媒体类型、每来源限流、全局限流、限流桶数量上限、CORS 精确协议/主机校验和最小错误响应。

## 4. 已确认并修复的问题

| 严重度 | 问题 | 攻击/失败场景 | 修复与回归证据 |
|---|---|---|---|
| 中 | 信任 `X-Forwarded-For` 首地址 | 客户端伪造首地址逐次绕过来源限流 | 受信代理模式改取最近的有效 IP；回归测试验证第二次请求返回 429 |
| 中 | CORS 同源判断只比较 Host | `http` 与 `https` 同主机被错误视为同源 | 同时比较协议、主机和端口；协议不同时返回 403 |
| 中 | 本地无认证开关可被误部署到公网 | `ALLOW_UNAUTHENTICATED_AGENT=1` 配合公网监听暴露服务端 Key | 强制要求无代理、回环 socket 和 loopback Host，否则 503 |
| 中 | 模型结果仅做浅层字段检查 | 无效 severity 绕过阻断，畸形数组触发前端异常，超长输出消耗内存/额度 | 对五种结果深层白名单、枚举、数量和长度校验；限制 token 和响应体 |
| 中 | 限流 Map 无上限且无全局额度闸门 | 大量伪造来源导致内存增长或消耗模型额度 | 限流桶上限与过期清理、LRU 淘汰、全局窗口限流 |
| 低 | 畸形 JSON 返回 500 | 客户端错误被记录成服务异常并泄露可探测差异 | 显式 `INVALID_JSON`，返回 400 |
| 低 | 接受任意 Content-Type | 非预期客户端可绕过接口契约 | 仅接受 `application/json` 或 `+json`，否则 415 |
| 低 | 健康接口暴露模型模式与保护状态 | 匿名扫描者获取部署细节 | 默认只返回 `{ok:true}`，详情需显式配置 |
| 中 | DeepSeek Key 存入 `sessionStorage` | 同源脚本可通过 Storage API 读取 Key | 改为模块闭包内存；刷新即清除；CSP 限制脚本和连接目标；iframe 中拒绝接收 Key |

## 5. 错误、日志与 Secret

- API Key、Bearer Token、文章正文和提示词不得进入日志。
- 安全失败日志仅包含随机 `requestId`、固定 operation、内部错误代码和错误类型。
- 5xx 向客户端返回稳定的泛化信息；供应商错误正文和堆栈不返回。
- `.env.local` 被 Git 忽略；生产 Secret 必须使用托管平台 Secret，不得写入 GitHub Pages、Actions 变量或构建产物。
- Pages 模式不保存 DeepSeek Key；刷新页面后需要重新输入。

## 6. 残余风险与部署检查

1. Pages 模式仍运行在浏览器信任边界内。恶意浏览器扩展、被入侵的 GitHub 账号或供应链修改可截获内存中的 Key；CSP 只能降低风险，不能替代隔离后端。
2. GitHub Pages 不能配置自定义响应头，meta CSP 不支持可靠的 `frame-ancestors`；应用额外在 JavaScript 中拒绝 iframe 模式输入 Key。
3. 后端限流是单进程内存状态，多实例部署必须改用 Redis/托管限流服务，否则实例之间不能共享计数。
4. 共享 Token 没有用户身份、独立配额、到期时间或审计主体，只适合个人/单一受信客户端。
5. 模型输出经过结构和 HTML 安全校验，但内容事实正确性仍需人工确认，发布审核不能视为法律或合规保证。

独立后端上线前必须确认：

- `AGENT_ACCESS_TOKEN` 使用至少 32 字符随机值并定期轮换。
- 公网环境禁止 `ALLOW_UNAUTHENTICATED_AGENT=1`。
- 只有在唯一且受信的反向代理后才设置 `TRUST_PROXY=1`。
- `ALLOWED_ORIGINS` 只列精确 HTTPS Origin，不包含通配符或路径。
- 平台强制 HTTPS/HSTS；服务端 Key 存在 Secret Manager；日志有访问控制和保留期限。
- 多实例部署使用共享限流与集中安全审计日志。

## 7. 自动化证据

安全回归覆盖：全部五个 Agent 路由的未认证拒绝、合法 Token、低强度 Token、非白名单 Origin、协议混淆 Origin、CORS 预检、代理头伪造、来源/全局限流基础路径、畸形 JSON、错误媒体类型、未声明字段、畸形嵌套对象、无效审核 severity、超大模型响应、HTML 清洗、Pages CSP、Key 非持久化和 iframe 防护。
