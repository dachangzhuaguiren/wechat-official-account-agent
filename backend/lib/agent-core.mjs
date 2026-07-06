const QUESTIONS = {
  shared: [
    { id: "audience", text: "这次宣传主要面向哪类读者？", hint: "例如：老客户、潜在企业客户、附近居民。" },
    { id: "objective", text: "这次宣传最希望读者采取什么行动？", hint: "例如：预约体验、报名活动、咨询销售。" },
  ],
  product: [
    { id: "selling-points", text: "最想突出的三个产品卖点是什么？", hint: "只写已确认、可以公开的事实。" },
    { id: "proof", text: "有哪些可验证的参数、案例或素材可以支撑这些卖点？", hint: "没有也可以回答“暂无”。" },
  ],
  event: [
    { id: "event-details", text: "活动时间、地点和参与方式分别是什么？", hint: "未确定的信息请直接写“待定”。" },
    { id: "experience", text: "参与者到现场能获得哪些具体体验或收获？", hint: "尽量列出可验证的环节。" },
  ],
  final: { id: "constraints", text: "有哪些必须保留的信息，或绝对不能出现的表达？", hint: "例如：禁用词、法律限制、品牌语气。" },
};

const SYSTEM_PROMPTS = {
  interview: "你是企业公众号营销策划 Agent。每次只追问一个最重要的问题，最多五轮；不得自行编造价格、日期、参数、案例或承诺。信息足够时返回 question 或 brief。",
  directions: "你是企业公众号内容策划。根据已确认营销简报给出恰好三组差异明确的标题与叙事提纲，不补充未经确认的事实。",
  draft: "你是企业公众号编辑。根据品牌档案、营销简报和选定方向写一篇中文公众号宣传文章。只使用已确认事实，缺失信息写成【待补充：具体项目】。正文只用 h1、h2、p、strong、em、blockquote、ul、ol、li、a、br、hr 标签。",
  rewrite: "你是谨慎的中文编辑。只改写用户选择的文本，严格保留事实、数字、专有名词和承诺边界。",
  audit: "你是营销事实审校员。对照营销简报检查未确认事实、绝对化表述、日期价格参数和行动信息，输出阻断项与警告。",
};

const RESULT_SCHEMAS = {
  interview: '{"status":"question","question":{"id":"question-id","text":"一个问题","hint":"回答提示"}} 或 {"status":"brief","brief":{"campaignType":"product|event","subject":"主题","audience":"目标读者","objective":"传播目标","keyMessage":"核心信息","proofPoints":["事实依据"],"cta":"行动指令","eventDetails":"活动信息或不适用","restrictions":["限制"],"missingFacts":["仍缺事实"]}}',
  directions: '{"directions":[{"id":"direction-id","title":"标题","angle":"叙事角度","outline":["提纲1","提纲2","提纲3"]}]}，directions 必须恰好包含三项',
  draft: '{"articleHtml":"仅包含允许标签的完整文章 HTML"}',
  rewrite: '{"replacement":"改写后的文本"}',
  audit: '{"issues":[{"id":"issue-id","severity":"blocking|warning","message":"问题说明","excerpt":"相关原文，可省略"}]}',
};

function answerOf(answers, id, fallback) {
  return answers.find((answer) => answer.questionId === id)?.answer?.trim() || fallback;
}

function cleanList(value) {
  return String(value || "").split(/[，,；;\n]/).map((item) => item.trim()).filter(Boolean);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function buildBrief(payload) {
  const isEvent = payload.campaignType === "event";
  const details = answerOf(payload.answers, isEvent ? "event-details" : "proof", "待补充");
  const message = answerOf(payload.answers, isEvent ? "experience" : "selling-points", "待补充");
  const restrictions = answerOf(payload.answers, "constraints", payload.brand?.forbiddenTerms || "无");
  const missingFacts = [];
  if (/待定|待补充|暂无/.test(details)) missingFacts.push(isEvent ? "活动时间、地点或参与方式" : "产品事实依据");
  if (/待补充/.test(message)) missingFacts.push(isEvent ? "现场体验内容" : "产品核心卖点");
  return {
    campaignType: payload.campaignType,
    subject: payload.idea,
    audience: answerOf(payload.answers, "audience", payload.brand?.targetAudience || "待补充"),
    objective: answerOf(payload.answers, "objective", payload.brand?.defaultCta || "待补充"),
    keyMessage: message,
    proofPoints: cleanList(details),
    cta: answerOf(payload.answers, "objective", payload.brand?.defaultCta || "待补充"),
    eventDetails: isEvent ? details : "不适用",
    restrictions: cleanList(restrictions),
    missingFacts,
  };
}

function mockInterview(payload) {
  const sequence = [...QUESTIONS.shared, ...(payload.campaignType === "event" ? QUESTIONS.event : QUESTIONS.product), QUESTIONS.final];
  const question = sequence[payload.answers.length];
  return question ? { status: "question", question } : { status: "brief", brief: buildBrief(payload) };
}

function mockDirections(brief) {
  const rawSubject = String(brief.subject || "本次宣传");
  const extracted = rawSubject.match(/(?:举办|发布|推出|宣传|开展)([^，。；]{2,18})/)?.[1];
  const subject = (extracted || rawSubject.split(/[，。；]/)[0] || "本次宣传").replace(/^一[场款次]/, "").slice(0, 20);
  return { directions: [
    { id: "value-first", title: `${subject}：先讲清楚为什么值得关注`, angle: "价值先行", outline: ["从目标读者的真实需求切入", "展开核心卖点与事实依据", "用清晰行动指令收束"] },
    { id: "scene-first", title: `${subject}：把读者带进真实场景`, angle: "场景体验", outline: ["用一个具体使用或参与场景开篇", "按体验顺序介绍亮点", "给出参与方式与注意事项"] },
    { id: "news-first", title: `${subject}：一篇清楚直接的正式发布`, angle: "信息发布", outline: ["开门见山公布核心信息", "分点说明内容与依据", "集中列出时间、方式与行动指令"] },
  ] };
}

function mockDraft({ brief, direction, brand }) {
  const proof = brief.proofPoints?.length ? brief.proofPoints : ["【待补充：可信依据】"];
  const company = brand?.companyName || "我们";
  return { articleHtml: [
    `<h1>${escapeHtml(direction.title)}</h1>`,
    `<p>${escapeHtml(brief.audience)}，这一次，${escapeHtml(company)}想把一件重要的事讲清楚：${escapeHtml(brief.keyMessage)}</p>`,
    "<blockquote>本文仅使用营销简报中已确认的信息；未确认内容会保留“待补充”标记。</blockquote>",
    `<h2>为什么值得关注</h2><p>${escapeHtml(brief.subject)}</p>`,
    `<h2>你将获得什么</h2><ul>${proof.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`,
    "<blockquote>【配图建议】在这里插入一张能够直接证明核心卖点的产品或活动现场图。</blockquote>",
    brief.campaignType === "event" ? `<h2>活动信息</h2><p>${escapeHtml(brief.eventDetails || "【待补充：活动时间、地点和参与方式】")}</p>` : "",
    `<h2>现在行动</h2><p><strong>${escapeHtml(brief.cta)}</strong></p>`,
  ].join("") };
}

function mockRewrite({ text, instruction }) {
  const source = String(text || "").trim();
  if (/缩短|精简/.test(instruction)) return { replacement: source.length > 52 ? `${source.slice(0, 50).replace(/[，,。.]$/, "")}。` : source };
  if (/扩写/.test(instruction)) return { replacement: `${source} 这不仅是一条信息，更是一次让目标读者了解价值、建立信任并采取行动的机会。` };
  if (/号召|感染/.test(instruction)) return { replacement: `${source.replace(/[。！!]$/, "")}——现在就行动，亲自感受这份改变。` };
  return { replacement: `${source.replace(/[。！!]$/, "")}，用更清晰、更自然的方式抵达真正关心它的人。` };
}

function mockAudit({ articleText, brief }) {
  const issues = [];
  if (/【待补充[:：]|待定/.test(articleText) || brief.missingFacts?.length) issues.push({ id: "missing-facts", severity: "blocking", message: "文章仍含未确认事实，请补齐后再复制发布。", excerpt: brief.missingFacts?.join("、") || "待补充占位符" });
  if (/百分百|绝对|第一|最[好佳强]/.test(articleText)) issues.push({ id: "absolute-claim", severity: "warning", message: "检测到绝对化表达，请确认是否具备公开依据。" });
  return { issues };
}

export function runMockOperation(operation, payload) {
  if (operation === "interview") return mockInterview(payload);
  if (operation === "directions") return mockDirections(payload.brief);
  if (operation === "draft") return mockDraft(payload);
  if (operation === "rewrite") return mockRewrite(payload);
  if (operation === "audit") return mockAudit(payload);
  throw new Error("未知 Agent 操作");
}

export function sanitizeArticleHtml(value) {
  const allowed = new Set(["h1", "h2", "p", "strong", "em", "blockquote", "ul", "ol", "li", "a", "br", "hr"]);
  return String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[^]*?-->/g, "")
    .replace(/<\/?([a-z0-9-]+)([^>]*)>/gi, (whole, rawTag, attributes) => {
      const tag = rawTag.toLowerCase();
      if (!allowed.has(tag)) return "";
      if (whole.startsWith("</")) return `</${tag}>`;
      if (tag === "a") {
        const href = String(attributes).match(/href\s*=\s*["']([^"']+)["']/i)?.[1] || "";
        return /^(https?:|mailto:)/i.test(href) ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">` : "<a>";
      }
      return `<${tag}>`;
    });
}

function validateResult(operation, value) {
  assertObject(value, "模型结果");
  if (operation === "interview") {
    assertAllowedKeys(value, ["status", "question", "brief"], "访谈结果");
    if (value.status === "question") {
      assertObject(value.question, "访谈问题");
      assertAllowedKeys(value.question, ["id", "text", "hint"], "访谈问题");
      assertIdentifier(value.question.id, "问题编号");
      assertString(value.question.text, "访谈问题", { min: 1, max: 1000 });
      assertString(value.question.hint, "回答提示", { min: 0, max: 1000 });
    } else if (value.status === "brief") validateBrief(value.brief, "营销简报");
    else throw agentError("INVALID_MODEL_RESULT", "访谈结果缺少有效状态");
  }
  if (operation === "directions") {
    assertAllowedKeys(value, ["directions"], "内容方向结果");
    if (!Array.isArray(value.directions) || value.directions.length !== 3) throw agentError("INVALID_MODEL_RESULT", "必须返回三组内容方向");
    value.directions.forEach((direction, index) => validateDirection(direction, `内容方向 ${index + 1}`));
  }
  if (operation === "draft") {
    assertAllowedKeys(value, ["articleHtml"], "正文结果");
    assertString(value.articleHtml, "正文 HTML", { min: 1, max: 200_000 });
  }
  if (operation === "rewrite") {
    assertAllowedKeys(value, ["replacement"], "改写结果");
    assertString(value.replacement, "改写结果", { min: 1, max: 20_000 });
  }
  if (operation === "audit") {
    assertAllowedKeys(value, ["issues"], "审校结果");
    if (!Array.isArray(value.issues) || value.issues.length > 50) throw agentError("INVALID_MODEL_RESULT", "审校问题数量无效");
    value.issues.forEach((issue, index) => {
      assertObject(issue, `审校问题 ${index + 1}`);
      assertAllowedKeys(issue, ["id", "severity", "message", "excerpt"], `审校问题 ${index + 1}`);
      assertIdentifier(issue.id, "审校问题编号");
      if (!["blocking", "warning"].includes(issue.severity)) throw agentError("INVALID_MODEL_RESULT", "审校严重级别无效");
      assertString(issue.message, "审校问题说明", { min: 1, max: 2000 });
      if (issue.excerpt !== undefined) assertString(issue.excerpt, "相关原文", { min: 0, max: 4000 });
    });
  }
  return value;
}

function parseJson(content) {
  return JSON.parse(String(content).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
}

function agentError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw agentError("INVALID_INPUT", `${field} 格式无效`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw agentError("INVALID_INPUT", `${field} 必须是普通对象`);
}

function assertString(value, field, { min = 0, max }) {
  if (typeof value !== "string" || value.trim().length < min || value.length > max) {
    throw agentError("INVALID_INPUT", `${field} 长度或格式无效`);
  }
}

function assertAllowedKeys(value, allowedKeys, field) {
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) throw agentError("INVALID_INPUT", `${field} 包含不允许的字段`);
}

function assertIdentifier(value, field) {
  assertString(value, field, { min: 1, max: 80 });
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(value)) throw agentError("INVALID_INPUT", `${field} 格式无效`);
}

function assertStringArray(value, field, { min = 0, max = 20, itemMax = 2000 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw agentError("INVALID_INPUT", `${field} 数量无效`);
  value.forEach((item, index) => assertString(item, `${field} ${index + 1}`, { min: 1, max: itemMax }));
}

function validateBrand(brand) {
  assertObject(brand, "品牌档案");
  const stringFields = ["companyName", "summary", "targetAudience", "tone", "keyPoints", "forbiddenTerms", "defaultCta"];
  assertAllowedKeys(brand, [...stringFields, "primaryColor", "accentColor"], "品牌档案");
  for (const field of stringFields) {
    if (brand[field] !== undefined) assertString(brand[field], `品牌档案 ${field}`, { min: 0, max: 4000 });
  }
  for (const field of ["primaryColor", "accentColor"]) {
    if (brand[field] !== undefined && !/^#[0-9a-f]{6}$/i.test(brand[field])) throw agentError("INVALID_INPUT", `品牌档案 ${field} 格式无效`);
  }
}

function validateBrief(brief, field = "营销简报") {
  assertObject(brief, field);
  assertAllowedKeys(brief, ["campaignType", "subject", "audience", "objective", "keyMessage", "proofPoints", "cta", "eventDetails", "restrictions", "missingFacts"], field);
  if (!["product", "event"].includes(brief.campaignType)) throw agentError("INVALID_INPUT", `${field} 宣传类型无效`);
  for (const name of ["subject", "audience", "objective", "keyMessage", "cta"]) assertString(brief[name], `${field} ${name}`, { min: 1, max: 4000 });
  assertString(brief.eventDetails, `${field} eventDetails`, { min: 1, max: 4000 });
  assertStringArray(brief.proofPoints, `${field} proofPoints`, { max: 20 });
  assertStringArray(brief.restrictions, `${field} restrictions`, { max: 20 });
  assertStringArray(brief.missingFacts, `${field} missingFacts`, { max: 20 });
}

function validateDirection(direction, field = "内容方向") {
  assertObject(direction, field);
  assertAllowedKeys(direction, ["id", "title", "angle", "outline"], field);
  assertIdentifier(direction.id, `${field} 编号`);
  assertString(direction.title, `${field} 标题`, { min: 1, max: 500 });
  assertString(direction.angle, `${field} 角度`, { min: 1, max: 500 });
  assertStringArray(direction.outline, `${field} 提纲`, { min: 1, max: 10, itemMax: 1000 });
}

function validateAssets(assets) {
  if (!Array.isArray(assets) || assets.length > 20) throw agentError("INVALID_INPUT", "图片素材数量无效");
  assets.forEach((asset, index) => {
    assertObject(asset, `图片素材 ${index + 1}`);
    assertAllowedKeys(asset, ["name", "description", "mimeType"], `图片素材 ${index + 1}`);
    assertString(asset.name, "图片文件名", { min: 1, max: 255 });
    assertString(asset.description, "图片描述", { min: 0, max: 2000 });
    if (asset.mimeType !== undefined && !/^image\/[a-z0-9.+-]{1,40}$/i.test(asset.mimeType)) throw agentError("INVALID_INPUT", "图片 MIME 类型无效");
  });
}

export function validateOperationPayload(operation, payload) {
  assertObject(payload, "请求内容");
  if (operation === "interview") {
    assertAllowedKeys(payload, ["campaignType", "idea", "answers", "brand"], "访谈请求");
    if (!["product", "event"].includes(payload.campaignType)) throw agentError("INVALID_INPUT", "宣传类型无效");
    assertString(payload.idea, "粗浅想法", { min: 1, max: 4000 });
    if (!Array.isArray(payload.answers) || payload.answers.length > 8) throw agentError("INVALID_INPUT", "访谈回答格式无效");
    for (const answer of payload.answers) {
      assertObject(answer, "访谈回答");
      assertAllowedKeys(answer, ["questionId", "question", "answer"], "访谈回答");
      assertString(answer.questionId, "问题编号", { min: 1, max: 80 });
      assertString(answer.question, "访谈问题", { min: 1, max: 1000 });
      assertString(answer.answer, "访谈回答", { min: 1, max: 4000 });
    }
  }
  if (operation === "directions") {
    assertAllowedKeys(payload, ["brief", "brand"], "内容方向请求");
    validateBrief(payload.brief);
  }
  if (operation === "draft") {
    assertAllowedKeys(payload, ["brief", "direction", "brand", "assets"], "正文请求");
    validateBrief(payload.brief);
    validateDirection(payload.direction);
    if (payload.assets !== undefined) validateAssets(payload.assets);
  }
  if (operation === "rewrite") {
    assertAllowedKeys(payload, ["text", "instruction", "brand", "brief"], "改写请求");
    assertString(payload.text, "待改写文本", { min: 1, max: 12000 });
    assertString(payload.instruction, "改写要求", { min: 1, max: 1000 });
    if (payload.brief !== undefined) validateBrief(payload.brief);
  }
  if (operation === "audit") {
    assertAllowedKeys(payload, ["articleText", "brief", "brand"], "审校请求");
    assertString(payload.articleText, "文章正文", { min: 1, max: 50000 });
    validateBrief(payload.brief);
  }
  if (payload.brand !== undefined) validateBrand(payload.brand);
  return payload;
}

function modelForOperation(operation, env) {
  if (["draft", "audit"].includes(operation) && env.AGENT_MODEL_QUALITY) return env.AGENT_MODEL_QUALITY;
  return env.AGENT_MODEL;
}

const DEFAULT_MAX_OUTPUT_TOKENS = {
  interview: 2000,
  directions: 3000,
  draft: 12000,
  rewrite: 3000,
  audit: 5000,
};

function maxOutputTokens(operation, env) {
  const configured = Number(env.AGENT_MAX_OUTPUT_TOKENS);
  if (Number.isFinite(configured) && configured > 0) return Math.min(Math.floor(configured), 20_000);
  return DEFAULT_MAX_OUTPUT_TOKENS[operation];
}

async function readLimitedResponseText(response, maxBytes = 2_000_000) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw agentError("PROVIDER_ERROR", "模型服务响应过大");
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).length > maxBytes) throw agentError("PROVIDER_ERROR", "模型服务响应过大");
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw agentError("PROVIDER_ERROR", "模型服务响应过大");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

async function providerCall(messages, env, model, operation) {
  const base = String(env.AGENT_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  if (!env.AGENT_API_KEY || !model) throw agentError("CONFIG_ERROR", "模型服务尚未完成配置");
  let providerUrl;
  try {
    const parsedBase = new URL(base);
    const hostname = parsedBase.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const loopback = hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.");
    const insecureLoopbackAllowed = env.AGENT_ALLOW_INSECURE_LOOPBACK === "1" && loopback;
    if (parsedBase.protocol !== "https:" && !(parsedBase.protocol === "http:" && insecureLoopbackAllowed)) throw new Error("secure protocol required");
    if (parsedBase.username || parsedBase.password || parsedBase.search || parsedBase.hash) throw new Error("provider URL contains forbidden components");
    providerUrl = `${parsedBase.href.replace(/\/$/, "")}/chat/completions`;
  } catch {
    throw agentError("CONFIG_ERROR", "模型服务地址无效");
  }
  const controller = new AbortController();
  const configuredTimeout = Number(env.AGENT_TIMEOUT_MS || 45000);
  const timeoutMs = Number.isFinite(configuredTimeout) ? Math.max(1000, Math.min(configuredTimeout, 90000)) : 45000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const requestBody = { model, temperature: 0.45, max_tokens: maxOutputTokens(operation, env), response_format: { type: "json_object" }, messages };
    if (env.AGENT_THINKING_MODE === "operation-based") {
      const thinkingEnabled = ["draft", "audit"].includes(operation);
      requestBody.thinking = { type: thinkingEnabled ? "enabled" : "disabled" };
      if (thinkingEnabled) {
        delete requestBody.temperature;
        requestBody.reasoning_effort = "high";
      }
    }
    const response = await fetch(providerUrl, { method: "POST", redirect: "error", headers: { "content-type": "application/json", authorization: `Bearer ${env.AGENT_API_KEY}` }, body: JSON.stringify(requestBody), signal: controller.signal });
    const body = await readLimitedResponseText(response);
    if (!response.ok) throw agentError("PROVIDER_ERROR", `模型服务返回 ${response.status}`);
    let parsed;
    try { parsed = JSON.parse(body); }
    catch { throw agentError("PROVIDER_ERROR", "模型服务返回了无效响应"); }
    const content = parsed.choices?.[0]?.message?.content;
    if (!content) throw agentError("PROVIDER_ERROR", "模型服务未返回正文");
    return content;
  } catch (error) {
    if (error?.code) throw error;
    if (error?.name === "AbortError") throw agentError("PROVIDER_ERROR", "模型服务响应超时");
    throw agentError("PROVIDER_ERROR", "无法连接模型服务");
  } finally { clearTimeout(timeout); }
}

export async function runAgentOperation(operation, payload, env = process.env) {
  if (!Object.hasOwn(SYSTEM_PROMPTS, operation)) throw new Error("未知 Agent 操作");
  validateOperationPayload(operation, payload);
  if ((env.AGENT_PROVIDER_MODE || "mock") === "mock") return runMockOperation(operation, payload);
  const model = modelForOperation(operation, env);
  const resultSchema = RESULT_SCHEMAS[operation];
  const messages = [
    { role: "system", content: `${SYSTEM_PROMPTS[operation]}\n必须只返回有效 JSON，不要使用 Markdown 代码块。输出必须严格符合以下结构，字段名不得替换：\n${resultSchema}` },
    { role: "user", content: JSON.stringify(payload) },
  ];
  let content = await providerCall(messages, env, model, operation);
  let result;
  try { result = validateResult(operation, parseJson(content)); }
  catch {
    content = await providerCall([...messages, { role: "assistant", content }, { role: "user", content: `上一个结果字段不符合要求。请严格修复为以下结构，只返回 JSON：\n${resultSchema}` }], env, model, operation);
    try { result = validateResult(operation, parseJson(content)); }
    catch { throw agentError("PROVIDER_ERROR", "模型返回结构不符合要求"); }
  }
  if (operation === "draft") result.articleHtml = sanitizeArticleHtml(result.articleHtml);
  return result;
}
