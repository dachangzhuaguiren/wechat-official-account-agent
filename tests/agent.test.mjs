import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { runAgentOperation, runMockOperation, sanitizeArticleHtml } from "../backend/lib/agent-core.mjs";
import { runStaticAgentOperation } from "../frontend/public/mock-agent.js";

const brand = { companyName: "示例品牌", targetAudience: "企业客户", defaultCta: "预约体验", forbiddenTerms: "绝对、第一" };
const validBrief = { campaignType: "product", subject: "新品发布", audience: "企业客户", objective: "预约体验", keyMessage: "已确认卖点", proofPoints: ["已有试点材料"], cta: "预约体验", eventDetails: "不适用", restrictions: [], missingFacts: [] };
const validDirection = { id: "value-first", title: "新品发布：值得关注的价值", angle: "价值先行", outline: ["读者需求", "事实依据", "行动指令"] };

test("访谈每次只返回一个问题并在五轮后生成简报", () => {
  const payload = { campaignType: "product", idea: "宣传一款新产品", brand, answers: [] };
  const first = runMockOperation("interview", payload);
  assert.equal(first.status, "question");
  assert.equal(first.question.id, "audience");
  payload.answers = [
    { questionId: "audience", answer: "企业采购负责人" },
    { questionId: "objective", answer: "预约演示" },
    { questionId: "selling-points", answer: "部署简单；数据清晰；服务稳定" },
    { questionId: "proof", answer: "已有试点材料" },
    { questionId: "constraints", answer: "不能使用绝对化表述" },
  ];
  const result = runMockOperation("interview", payload);
  assert.equal(result.status, "brief");
  assert.equal(result.brief.audience, "企业采购负责人");
  assert.deepEqual(result.brief.missingFacts, []);
});

test("内容方向固定返回三组并可生成可编辑 HTML", () => {
  const brief = { campaignType: "event", subject: "开放日活动", audience: "附近居民", objective: "报名", keyMessage: "现场体验", proofPoints: ["产品演示"], cta: "立即报名", eventDetails: "7月10日，公司展厅", restrictions: [], missingFacts: [] };
  const { directions } = runMockOperation("directions", { brief });
  assert.equal(directions.length, 3);
  const { articleHtml } = runMockOperation("draft", { brief, direction: directions[0], brand });
  assert.match(articleHtml, /<h1>/);
  assert.match(articleHtml, /立即报名/);
});

test("Mock 方向会从长想法中提取简短活动主题", () => {
  const brief = { subject: "我们准备在7月10日下午两点举办新品体验日，地点在公司展厅。" };
  const { directions } = runMockOperation("directions", { brief });
  assert.match(directions[0].title, /^新品体验日：/);
});

test("GitHub Pages 浏览器 Agent 与服务端 Mock 生成一致", () => {
  const payload = {
    brief: { subject: "夏季新品发布", campaignType: "product" },
  };
  assert.deepEqual(
    runStaticAgentOperation("directions", payload),
    runMockOperation("directions", payload),
  );
});

test("发布检查阻止含待补充信息的文章", () => {
  const result = runMockOperation("audit", { articleText: "【待补充：活动时间】", brief: { missingFacts: ["活动时间"] } });
  assert.equal(result.issues[0].severity, "blocking");
});

test("正文清洗移除脚本、事件属性和未知标签", () => {
  const clean = sanitizeArticleHtml('<h1 onclick="bad()">标题</h1><script>alert(1)</script><iframe src="x">危险</iframe><a href="jav&#x61;script:bad()" onclick="bad()">链接</a><svg onload="bad()">图</svg>');
  assert.equal(clean.includes("script"), false);
  assert.equal(clean.includes("onclick"), false);
  assert.equal(clean.includes("iframe"), false);
  assert.equal(clean.includes("javascript:"), false);
});

test("OpenAI-compatible 适配器调用 chat/completions 并解析结构化结果", async (t) => {
  let authorization = "";
  let requestPayload;
  let reportedUsage;
  const provider = http.createServer(async (request, response) => {
    authorization = request.headers.authorization || "";
    let body = "";
    for await (const chunk of request) body += chunk;
    requestPayload = JSON.parse(body);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ replacement: "保留事实后的自然表达" }) } }], usage: { prompt_tokens: 123, completion_tokens: 45 } }));
  }).listen(0, "127.0.0.1");
  await once(provider, "listening");
  t.after(() => provider.close());
  const { port } = provider.address();
  const result = await runAgentOperation("rewrite", { text: "原文", instruction: "更自然" }, {
    AGENT_PROVIDER_MODE: "openai-compatible",
    AGENT_BASE_URL: `http://127.0.0.1:${port}`,
    AGENT_ALLOW_INSECURE_LOOPBACK: "1",
    AGENT_API_KEY: "test-key",
    AGENT_MODEL: "test-model",
    AGENT_THINKING_MODE: "operation-based",
    AGENT_TIMEOUT_MS: "2000",
  }, { providerUserId: "0123456789abcdef", onUsage: (usage) => { reportedUsage = usage; } });
  assert.equal(result.replacement, "保留事实后的自然表达");
  assert.equal(authorization, "Bearer test-key");
  assert.equal(requestPayload.model, "test-model");
  assert.equal(requestPayload.max_tokens, 3000);
  assert.deepEqual(requestPayload.response_format, { type: "json_object" });
  assert.deepEqual(requestPayload.thinking, { type: "disabled" });
  assert.equal(requestPayload.user_id, "0123456789abcdef");
  assert.match(requestPayload.messages[0].content, /"replacement"/);
  assert.deepEqual(reportedUsage, { operation: "rewrite", model: "test-model", inputTokens: 123, outputTokens: 45 });
});

test("成稿和审核使用质量模型", async (t) => {
  let requestPayload;
  const provider = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requestPayload = JSON.parse(body);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ articleHtml: "<h1>真实成稿</h1>" }) } }] }));
  }).listen(0, "127.0.0.1");
  await once(provider, "listening");
  t.after(() => provider.close());
  const { port } = provider.address();
  await runAgentOperation("draft", { brief: validBrief, direction: validDirection, brand: {}, assets: [] }, {
    AGENT_PROVIDER_MODE: "openai-compatible",
    AGENT_BASE_URL: `http://127.0.0.1:${port}`,
    AGENT_ALLOW_INSECURE_LOOPBACK: "1",
    AGENT_API_KEY: "test-key",
    AGENT_MODEL: "deepseek-v4-flash",
    AGENT_MODEL_QUALITY: "deepseek-v4-pro",
    AGENT_THINKING_MODE: "operation-based",
  });
  assert.equal(requestPayload.model, "deepseek-v4-pro");
  assert.deepEqual(requestPayload.thinking, { type: "enabled" });
  assert.equal(requestPayload.reasoning_effort, "high");
  assert.equal(Object.hasOwn(requestPayload, "temperature"), false);
  assert.equal(requestPayload.max_tokens, 12000);
});

test("Agent 输入拒绝未声明字段和畸形嵌套对象", async () => {
  await assert.rejects(
    runAgentOperation("rewrite", { text: "原文", instruction: "自然", brand: {}, role: "admin" }),
    (error) => error?.code === "INVALID_INPUT",
  );
  await assert.rejects(
    runAgentOperation("draft", { brief: validBrief, direction: { ...validDirection, outline: "not-an-array" }, brand: {} }),
    (error) => error?.code === "INVALID_INPUT",
  );
  await assert.rejects(
    runAgentOperation("interview", { campaignType: "product", idea: "测试", answers: [{ questionId: "q1", question: "问题", answer: "回答", role: "admin" }], brand: {} }),
    (error) => error?.code === "INVALID_INPUT",
  );
});

test("真实模型地址强制 HTTPS，仅显式允许回环开发服务", async () => {
  await assert.rejects(
    runAgentOperation("rewrite", { text: "原文", instruction: "自然", brand: {} }, {
      AGENT_PROVIDER_MODE: "openai-compatible",
      AGENT_BASE_URL: "http://provider.example.test/v1",
      AGENT_API_KEY: "test-key",
      AGENT_MODEL: "test-model",
    }),
    (error) => error?.code === "CONFIG_ERROR",
  );
});

test("Agent 拒绝无效审核级别，避免绕过阻断规则", async (t) => {
  const provider = http.createServer(async (request, response) => {
    for await (const _chunk of request) { /* consume body */ }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ issues: [{ id: "unsafe", severity: "info", message: "不可识别级别" }] }) } }] }));
  }).listen(0, "127.0.0.1");
  await once(provider, "listening");
  t.after(() => provider.close());
  const { port } = provider.address();
  await assert.rejects(
    runAgentOperation("audit", { articleText: "待审核正文", brief: validBrief, brand: {} }, {
      AGENT_PROVIDER_MODE: "openai-compatible",
      AGENT_BASE_URL: `http://127.0.0.1:${port}`,
      AGENT_ALLOW_INSECURE_LOOPBACK: "1",
      AGENT_API_KEY: "test-key",
      AGENT_MODEL: "test-model",
    }),
    (error) => error?.code === "PROVIDER_ERROR",
  );
});

test("Agent 拒绝超过响应大小上限的模型返回", async (t) => {
  const provider = http.createServer(async (request, response) => {
    for await (const _chunk of request) { /* consume body */ }
    response.writeHead(200, { "content-type": "application/json", "content-length": "2000001" });
    response.end("{}");
  }).listen(0, "127.0.0.1");
  await once(provider, "listening");
  t.after(() => provider.close());
  const { port } = provider.address();
  await assert.rejects(
    runAgentOperation("rewrite", { text: "原文", instruction: "自然", brand: {} }, {
      AGENT_PROVIDER_MODE: "openai-compatible",
      AGENT_BASE_URL: `http://127.0.0.1:${port}`,
      AGENT_ALLOW_INSECURE_LOOPBACK: "1",
      AGENT_API_KEY: "test-key",
      AGENT_MODEL: "test-model",
    }),
    (error) => error?.code === "PROVIDER_ERROR" && /响应过大/.test(error.message),
  );
});
