# 后端安全边界与 API 权限表

审查日期：2026-07-06
适用提交：本文件所在提交
生产入口：`https://k8w98rr595-blip.github.io/wechat-official-account-agent/`

## 1. 架构与信任边界

当前有三种互斥的模型调用模式：

1. **GitHub Pages 生产模式（当前启用）**：浏览器要求使用者输入自己的 DeepSeek API Key，Key 仅保存在页面 JavaScript 内存中，浏览器直接请求 `https://api.deepseek.com/chat/completions`。
2. **独立后端模式（可选）**：浏览器使用共享 `AGENT_ACCESS_TOKEN` 调用 Node 后端，后端再用服务端 `AGENT_API_KEY` 请求模型供应商。
3. **企业 SaaS 模式（待部署启用）**：用户登录企业账号，服务端按企业成员关系、角色、订阅与成稿额度授权；工作区、订单和用量写入单实例 SQLite。

| 边界 | 不可信输入 | 可信配置 | 主要控制 |
|---|---|---|---|
| 浏览器 → GitHub Pages | URL、导入备份、编辑内容、图片描述 | 仓库发布产物 | CSP、HTML 清洗、固定静态资源路径 |
| 浏览器 → DeepSeek | 所有文章与提示词内容 | 使用者临时输入的 Key、固定官方 API 地址 | Key 仅内存保存、固定模型、输入/输出结构与长度校验、响应大小与超时限制 |
| 客户端 → Node API | Origin、Host、转发头、Bearer Token、JSON Body | 服务端环境变量 | CORS 精确 Origin、Bearer Token、全局与来源限流、JSON 媒体类型和大小限制 |
| SaaS 浏览器 → 企业 API | 会话 Token、企业 ID、用户/角色/价格/工作区版本 | 服务端会话、成员关系、套餐价格和 SQLite 记录 | scrypt 密码、随机会话、逐请求租户过滤、角色白名单、事务、唯一约束、乐观版本锁 |
| Node API → 模型供应商 | 经校验的业务字段、模型返回 | API Key、Base URL、模型名 | 强制 HTTPS；仅显式允许回环开发 HTTP；禁止重定向；超时、最大输出 token、2MB 响应上限、深层模型结果校验 |
| 浏览器 → IndexedDB | 导入的工作区和模型生成内容 | 当前浏览器同源存储 | HTML DOM 清洗、完整备份 Schema、项目/字段/图片上限、可选 AES-GCM 加密备份；不保存 API Key 或访问码 |

## 2. 身份与能力

| 身份 | 认证方式 | 能力 | 数据所有权 |
|---|---|---|---|
| 匿名访问者 | 无 | 读取静态资源、读取最小健康状态 | 无服务端记录 |
| Pages 使用者 | 自己的 DeepSeek API Key，由 DeepSeek 验证 | 使用自己的额度执行五项 Agent 操作 | 草稿仅在自己的浏览器 IndexedDB |
| 后端 Agent 客户端 | `Authorization: Bearer <AGENT_ACCESS_TOKEN>`，Token 至少 32 字符 | `agent:invoke`，可调用五项 Agent 操作 | 后端不保存文章或用户记录，因此没有跨用户记录权限 |
| SaaS 企业所有者 | 随机 Bearer 会话 + 企业 ID | 企业设置、成员、工作区、订单、退款、Agent | 只能访问服务端确认其为成员的企业；不能转移或删除所有者 |
| SaaS 管理员 | 同上 | 成员、工作区、账单、Agent | 不能授予 owner、不能修改自己角色、受套餐成员上限约束 |
| SaaS 编辑 | 同上 | 工作区读写和 Agent | 无成员、订单、退款或平台管理权限 |
| SaaS 审核人 | 同上 | 只读工作区 | 服务端拒绝工作区写入和全部 Agent 操作 |
| 平台管理员 | SaaS 会话且数据库 `platform_admin=1` | 全局指标、人工确认订单、处理退款 | 管理员身份只可在注册时由匹配的服务端启动邮箱配置授予 |
| 本地开发者 | 仅无代理、回环地址和 localhost Host 可使用无认证例外 | 本机调试 Agent | 仅本机进程 |
| 仓库/部署管理员 | GitHub 与托管平台权限 | 修改代码、公开配置、服务端 Secret | 负责 Secret 轮换和部署审计 |

共享 Token 模式仍只适合个人或单一受信客户端。企业 SaaS 模式已经提供真实身份、会话撤销、按企业额度、角色和租户隔离；两个模式不能同时作为同一路径的授权依据。

## 3. API 权限边界表

| 路径 / 方法 | 访问能力 | 认证与授权 | 输入控制 | 外部副作用 | 响应与审计 |
|---|---|---|---|---|---|
| `GET /api/health` | `health:read`（公开） | 无；默认只返回 `{ok:true}` | 无业务输入；CORS 仍按 Origin 执行 | 无 | `no-store`，不暴露模型或 Secret 状态；仅显式开启 `EXPOSE_HEALTH_DETAILS=1` 才返回详情 |
| `OPTIONS /api/*` | CORS 预检（公开） | Origin 必须是精确同源或在 `ALLOWED_ORIGINS` | 只允许固定方法及 `authorization/content-type/x-organization-id/x-idempotency-key` | 无 | 204，缓存 600 秒 |
| `POST /api/saas/register`、`login`、`logout` | 账户会话 | 登录/注册来源独立限流；密码 scrypt；登录错误不区分账号是否存在 | 邮箱、姓名、企业名和密码长度/格式白名单 | 创建用户、企业、试用订阅、会话 | 不返回密码哈希；记录注册和会话审计事件 |
| `GET/PATCH /api/saas/organization`、成员路由 | 企业管理 | 服务端会话 + 企业成员；变更限 owner/admin | 角色只允许 admin/editor/reviewer；禁止客户端授予 owner | 修改企业和成员关系 | 记录操作者、目标用户与新角色，不记录正文或 Token |
| `GET/PUT /api/saas/workspace` | 企业工作区 | 读取限企业成员；写入限 owner/admin/editor | 完整工作区 Schema；15MB 请求上限；服务端版本号 | SQLite 原子更新 | 版本冲突返回 409，防止静默覆盖其他成员修改 |
| `GET/POST /api/saas/orders`、退款路由 | 企业账单 | owner/admin 且订单必须属于当前企业 | 套餐与价格从服务端常量读取；订单幂等键；退款金额取原订单 | 创建订单和退款申请 | 非法状态迁移或重复退款返回 409 |
| `/api/saas/admin/*` | 平台管理 | 必须是数据库平台管理员 | 固定订单/退款 ID 和布尔处理结果 | 人工确认支付并开通套餐；批准退款并取消订阅 | 全部变更进入审计日志；不返回密码、会话或工作区正文 |
| `POST /api/agent/interview` | `agent:invoke` | 共享 Bearer Token；真实模型无 Token 时拒绝。无认证例外仅限本机回环 | `campaignType` 枚举；idea ≤ 4000；回答 ≤ 8，每项只允许 ID、原问题和回答且长度受限；品牌字段白名单 | 调用 Flash；最多 2000 输出 tokens；最多一次结构修复重试 | 返回单问题或完整简报；安全日志只记录 requestId、固定操作名、状态和可选 HMAC 来源标识，不记录正文或 Key |
| `POST /api/agent/directions` | `agent:invoke` | 同上 | 顶层字段白名单；简报所有字段、字符串和数组深层校验 | 调用 Flash；最多 3000 输出 tokens | 必须返回恰好 3 个方向，每项 ID、标题、角度、提纲均校验 |
| `POST /api/agent/draft` | `agent:invoke` | 同上 | 简报、方向和品牌深层校验；图片 ≤ 20，仅接收名称、描述和 MIME，不接收图片二进制 | 调用 Pro；高强度思考；最多 12000 输出 tokens | HTML ≤ 200KB，并移除未知标签、脚本、样式和危险链接属性 |
| `POST /api/agent/rewrite` | `agent:invoke` | 同上 | 原文 ≤ 12000；指令 ≤ 1000；品牌/简报字段白名单 | 调用 Flash；最多 3000 输出 tokens | replacement 必须是 1–20000 字符字符串 |
| `POST /api/agent/audit` | `agent:invoke` | 同上 | 正文 ≤ 50000；简报和品牌深层校验 | 调用 Pro；高强度思考；最多 5000 输出 tokens | issues ≤ 50；severity 只允许 `blocking` 或 `warning`，防止绕过发布阻断 |
| 其他 `/api/*` 或错误方法 | 无 | 默认拒绝 | 路由和方法固定白名单 | 无 | 404，不暴露内部路由 |
| 固定静态资源 `GET /` 等 | `static:read`（公开） | 无 | `Map` 固定路径，不接受文件路径参数 | 读取仓库内固定文件 | CSP、`nosniff`、`no-referrer`、禁用 framing/权限能力 |

SaaS 模式下 Agent 路由还会逐请求验证企业成员和编辑权限；`draft` 必须带幂等键，事务预留一篇额度，失败释放、成功提交。模型 Token 和估算成本按企业/用户记录。所有 Agent POST 请求仍统一执行请求体、媒体类型、来源/全局限流、CORS、超时和最小错误响应。

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
| 高 | 模型 Base URL 允许普通 HTTP | 配置错误时服务端 API Key 可能通过明文网络发送 | 生产强制 HTTPS；只有 `AGENT_ALLOW_INSECURE_LOOPBACK=1` 且目标为回环地址时允许 HTTP；Fetch 禁止重定向 |
| 中 | 备份只做顶层检查 | 恶意备份字段进入 HTML 属性、图片地址或超大数组，造成注入与持久化拒绝服务 | 新增深层 Schema、字段白名单、状态一致性、ID/颜色/Data URL、数量和长度校验；增加加密备份与清除本地数据 |
| 中 | 无效 Token 在认证前消耗模型额度 | 攻击者重复发送错误 Token，使合法用户收到 429 | 认证失败使用独立来源桶；只有认证成功请求才扣除来源和全局模型额度 |
| 中 | 服务器采用较宽松默认连接参数 | 慢速请求占用单进程连接 | 显式限制请求、请求头、Socket、Keep-Alive、Header 数和单连接请求数 |
| 中 | GitHub Actions 使用可变主版本标签 | 上游标签被替换时部署链可能执行未审查代码 | 所有 Action 固定到完整 Commit SHA；Dependabot 只通过 PR 提议升级；增加 CODEOWNERS 与 SECURITY.md |
| 高 | 多用户若继续共用访问码会发生横向越权 | 任一持码者可读取或消耗所有企业数据与额度 | 新增独立账户、企业成员表、四级角色及每条资源查询的企业过滤；跨租户回归测试返回 403/404 |
| 高 | 客户端价格、角色或支付状态可被篡改 | 用户把 ¥199 改为 ¥0.01、把自己改为 owner 或伪造已支付 | 套餐价格和角色能力只来自服务端常量/数据库；订单确认仅平台管理员；未知字段拒绝 |
| 高 | 重试成稿可能重复扣额度或重复创建订单 | 网络重试造成双扣、双订单或双退款 | 企业级幂等键、唯一约束、事务化额度预留/释放、订单与退款唯一约束、状态机校验 |
| 中 | 多人编辑静默覆盖云端草稿 | 两名编辑基于旧版本保存，后提交者覆盖先提交者 | 工作区使用整数版本和乐观锁；版本不一致返回 409并要求刷新 |
| 中 | 模型调用成本不可归属 | 公开后端被滥用但无法定位企业或控制毛利 | 每次真实模型调用记录企业、用户、操作、模型、输入/输出 Token 和估算微美元成本 |

## 5. 错误、日志与 Secret

- API Key、Bearer Token、文章正文和提示词不得进入日志。
- 安全失败日志为结构化 JSON，只包含随机 `requestId`、固定 operation/event、状态、内部错误代码和可选 HMAC 来源标识。
- 5xx 向客户端返回稳定的泛化信息；供应商错误正文和堆栈不返回。
- `.env.local` 被 Git 忽略；生产 Secret 必须使用托管平台 Secret，不得写入 GitHub Pages、Actions 变量或构建产物。
- Pages 个人模式不保存 DeepSeek Key；独立后端访问码也只保存在内存。SaaS 会话 Token 保存在当前标签页 `sessionStorage`，关闭标签页后清除。

## 6. 残余风险与部署检查

1. Pages 模式仍运行在浏览器信任边界内。恶意浏览器扩展、被入侵的 GitHub 账号或供应链修改可截获内存中的 Key；CSP 只能降低风险，不能替代隔离后端。
2. GitHub Pages 不能配置自定义响应头，meta CSP 不支持可靠的 `frame-ancestors`；应用额外在 JavaScript 中拒绝 iframe 模式输入 Key。
3. SaaS 数据库和限流均为单实例设计。多实例部署必须迁移 PostgreSQL，并使用 Redis/托管限流及集中日志。
4. 共享 Token 模式没有用户身份、独立配额、到期时间或审计主体，只适合个人/单一受信客户端；企业模式必须开启 `SAAS_ENABLED=1`。
5. 模型输出经过结构和 HTML 安全校验，但内容事实正确性仍需人工确认，发布审核不能视为法律或合规保证。
6. GitHub Pages 无法设置响应头级 CSP/`frame-ancestors`；应用已在 iframe 中停止加载，但完整响应头仍需 Cloudflare/Vercel 等边缘层。
7. SaaS 尚未实现邮箱验证、密码找回、MFA和设备会话管理；正式开放注册前至少需要邮箱验证与找回流程。
8. 当前订单/退款采用人工核对适配器，只能在实际线下到账/退款后由管理员更新。接入微信支付时必须验证回调签名和防重放，并以支付 API 成功结果为准。
9. 浏览器会话 Token 可被同源 XSS 读取；严格 CSP、无第三方脚本和输出清洗降低风险，但正式同域部署应升级为短期访问令牌加安全刷新 Cookie。

独立后端上线前必须确认：

- `AGENT_ACCESS_TOKEN` 使用至少 32 字符随机值并定期轮换。
- 公网环境禁止 `ALLOW_UNAUTHENTICATED_AGENT=1`。
- 只有在唯一且受信的反向代理后才设置 `TRUST_PROXY=1`。
- `ALLOWED_ORIGINS` 只列精确 HTTPS Origin，不包含通配符或路径。
- 平台强制 HTTPS/HSTS；服务端 Key 存在 Secret Manager；日志有访问控制和保留期限。
- `AGENT_BASE_URL` 使用 HTTPS；生产禁止 `AGENT_ALLOW_INSECURE_LOOPBACK=1`。
- `AUDIT_LOG_KEY` 使用至少 32 字符随机值，以便生成不可逆来源标识。
- 多实例部署使用共享限流与集中安全审计日志。
- `SAAS_DATABASE_PATH` 指向持久化磁盘并纳入加密备份和恢复演练。
- 平台管理员初始化同时校验预设邮箱和至少 32 字符的初始化码；首次注册完成后清空 `SAAS_BOOTSTRAP_ADMIN_EMAIL` 与 `SAAS_BOOTSTRAP_ADMIN_TOKEN`。
- Pages Actions variables 同时设置后端 HTTPS `AGENT_API_BASE_URL` 和 `SAAS_ENABLED=1`。
- 真实支付上线前完成商户回调签名、退款 API、对账和故障补偿测试。
- GitHub `main` 启用分支保护、必需检查和 CODEOWNERS 审核；仓库管理员启用 2FA/Passkey。

## 7. 自动化证据

安全回归覆盖：原有全部 Agent、CORS、限流、HTML、Pages 和备份边界；新增 scrypt 密码/会话、跨租户读取、角色篡改、审核人写入、工作区版本冲突、恶意云端数据、额度失败释放与重复请求、服务端价格、订单幂等、跨企业退款、平台管理员限制和日志敏感信息检查。
