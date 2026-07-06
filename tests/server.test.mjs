import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { createServer } from "../backend/server.mjs";

test("服务健康检查、静态入口和 Mock Agent API 可用", async (t) => {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const health = await fetch(`${base}/api/health`).then((response) => response.json());
  assert.deepEqual(health, { ok: true });

  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
  const pageHtml = await page.text();
  assert.match(pageHtml, /公众号写作 Agent/);
  assert.match(pageHtml, /src="\.\/app\.js"/);

  const staticAgent = await fetch(`${base}/mock-agent.js`);
  assert.equal(staticAgent.status, 200);
  assert.match(await staticAgent.text(), /runStaticAgentOperation/);

  const browserAgentCore = await fetch(`${base}/agent-core.js`);
  assert.equal(browserAgentCore.status, 200);
  assert.match(await browserAgentCore.text(), /runAgentOperation/);

  const workspaceSchema = await fetch(`${base}/workspace-schema.js`);
  assert.equal(workspaceSchema.status, 200);
  assert.match(await workspaceSchema.text(), /normalizeWorkspaceBackup/);

  const interview = await fetch(`${base}/api/agent/interview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaignType: "product", idea: "新品宣传", answers: [], brand: {} }) });
  assert.equal(interview.status, 200);
  assert.equal((await interview.json()).status, "question");

  const sameOriginInterview = await fetch(`${base}/api/agent/interview`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ campaignType: "product", idea: "新品宣传", answers: [], brand: {} }) });
  assert.equal(sameOriginInterview.status, 200);
});

test("Agent API 对同一来源执行速率限制", async (t) => {
  const server = createServer({ rateLimitMax: 1 }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/api/agent/interview`;
  const init = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ campaignType: "product", idea: "新品宣传", answers: [], brand: {} }),
  };

  assert.equal((await fetch(url, init)).status, 200);
  const limited = await fetch(url, init);
  assert.equal(limited.status, 429);
  assert.match((await limited.json()).error, /请求过于频繁/);
});

test("认证失败不会消耗合法模型额度，并有独立暴力尝试限制", async (t) => {
  const token = "valid-access-token-that-is-at-least-32-characters";
  const events = [];
  const server = createServer({ providerMode: "mock", accessToken: token, rateLimitMax: 1, globalRateLimitMax: 1, authRateLimitMax: 1, securityLogger: (event) => events.push(event) }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/api/agent/interview`;
  const body = JSON.stringify({ campaignType: "product", idea: "新品宣传", answers: [], brand: {} });

  const invalid = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer invalid-token-that-is-long-enough" }, body });
  assert.equal(invalid.status, 401);
  const valid = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body });
  assert.equal(valid.status, 200);

  assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer bad-token-one" }, body })).status, 401);
  const authLimited = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer bad-token-two" }, body });
  assert.equal(authLimited.status, 429);
  assert.equal(events.some((event) => event.event === "auth_rate_limited"), true);
  assert.equal(JSON.stringify(events).includes(token), false);
});

test("服务器显式限制慢请求、请求头和单连接请求数", () => {
  const server = createServer({ requestTimeout: 45_000, headersTimeout: 10_000, socketTimeout: 50_000, maxHeadersCount: 64, maxRequestsPerSocket: 32 });
  assert.equal(server.requestTimeout, 45_000);
  assert.equal(server.headersTimeout, 10_000);
  assert.equal(server.timeout, 50_000);
  assert.equal(server.maxHeadersCount, 64);
  assert.equal(server.maxRequestsPerSocket, 32);
});

test("公开真实 AI API 拒绝未授权和非白名单来源", async (t) => {
  const allowedOrigin = "https://k8w98rr595-blip.github.io";
  const server = createServer({
    providerMode: "openai-compatible",
    accessToken: "personal-access-code-that-is-at-least-32-characters",
    allowedOrigins: allowedOrigin,
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/api/agent/interview`;

  const unauthorized = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", origin: allowedOrigin },
    body: "{}",
  });
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get("access-control-allow-origin"), allowedOrigin);

  const forbiddenOrigin = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://attacker.example" },
    body: "{}",
  });
  assert.equal(forbiddenOrigin.status, 403);

  const preflight = await fetch(url, {
    method: "OPTIONS",
    headers: { origin: allowedOrigin, "access-control-request-method": "POST" },
  });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get("access-control-allow-headers") || "", /authorization/);
});

test("真实 AI 模式没有访问保护时拒绝服务", async (t) => {
  const server = createServer({ providerMode: "openai-compatible" }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/agent/interview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 503);
});

test("无认证开发例外仅允许回环 Host 且不能与受信代理并用", async (t) => {
  const server = createServer({ providerMode: "openai-compatible", allowUnauthenticatedAgent: true }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();
  const requestBody = JSON.stringify({ campaignType: "product", idea: "新品", answers: [], brand: {} });
  const response = await new Promise((resolve, reject) => {
    const request = http.request({ hostname: "127.0.0.1", port, path: "/api/agent/interview", method: "POST", headers: { host: "public.example", "content-type": "application/json", "content-length": Buffer.byteLength(requestBody) } }, async (incoming) => {
      let body = "";
      for await (const chunk of incoming) body += chunk;
      resolve({ status: incoming.statusCode, body: JSON.parse(body) });
    });
    request.on("error", reject);
    request.end(requestBody);
  });
  assert.equal(response.status, 503);
  assert.match(response.body.error, /访问保护/);

  const proxiedServer = createServer({ providerMode: "openai-compatible", allowUnauthenticatedAgent: true, trustProxy: true }).listen(0, "127.0.0.1");
  await once(proxiedServer, "listening");
  t.after(() => proxiedServer.close());
  const proxiedPort = proxiedServer.address().port;
  const proxied = await fetch(`http://127.0.0.1:${proxiedPort}/api/agent/interview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: requestBody,
  });
  assert.equal(proxied.status, 503);
});

test("共享访问码保护全部 Agent 操作且不暴露未知 API", async (t) => {
  const token = "a-secure-personal-access-code-with-32-characters";
  const server = createServer({ providerMode: "mock", accessToken: token }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  for (const operation of ["interview", "directions", "draft", "rewrite", "audit"]) {
    const response = await fetch(`${base}/api/agent/${operation}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(response.status, 401, operation);
  }
  const authorized = await fetch(`${base}/api/agent/interview`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ campaignType: "product", idea: "新品", answers: [], brand: {} }),
  });
  assert.equal(authorized.status, 200);
  assert.equal((await fetch(`${base}/api/admin`)).status, 404);
  assert.equal((await fetch(`${base}/api/agent/interview`)).status, 404);
});

test("Agent API 拒绝畸形 JSON、错误媒体类型和未声明字段", async (t) => {
  const server = createServer({ providerMode: "mock", rateLimitMax: 20 }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/api/agent/interview`;

  const malformed = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
  assert.equal(malformed.status, 400);

  const wrongType = await fetch(url, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
  assert.equal(wrongType.status, 415);

  const unexpected = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ campaignType: "product", idea: "新品", answers: [], brand: {}, role: "admin" }),
  });
  assert.equal(unexpected.status, 400);
});

test("CORS 同源判断同时校验协议和主机", async (t) => {
  assert.throws(() => createServer({ allowedOrigins: "*" }), /无效 Origin/);
  assert.throws(() => createServer({ allowedOrigins: "https://example.com/path" }), /精确的 HTTP\(S\) Origin/);
  assert.throws(() => createServer({ allowedOrigins: "http://example.com" }), /精确的 HTTP\(S\) Origin/);
  assert.doesNotThrow(() => createServer({ allowedOrigins: "http://127.0.0.1:3212" }));
  const server = createServer({ providerMode: "mock" }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/agent/interview`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: `https://127.0.0.1:${port}` },
    body: JSON.stringify({ campaignType: "product", idea: "新品", answers: [], brand: {} }),
  });
  assert.equal(response.status, 403);
});

test("受信代理模式使用最近的转发地址，无法伪造首地址绕过限流", async (t) => {
  const server = createServer({ providerMode: "mock", trustProxy: true, rateLimitMax: 1 }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/api/agent/interview`;
  const body = JSON.stringify({ campaignType: "product", idea: "新品", answers: [], brand: {} });
  const first = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.10, 203.0.113.1" }, body });
  const spoofed = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.11, 203.0.113.1" }, body });
  assert.equal(first.status, 200);
  assert.equal(spoofed.status, 429);
});

test("全局限流阻止轮换地址消耗额度，来源桶数量保持有界", async (t) => {
  const payload = JSON.stringify({ campaignType: "product", idea: "新品", answers: [], brand: {} });
  const globalServer = createServer({ providerMode: "mock", trustProxy: true, rateLimitMax: 1, globalRateLimitMax: 2 }).listen(0, "127.0.0.1");
  await once(globalServer, "listening");
  t.after(() => globalServer.close());
  const globalPort = globalServer.address().port;
  const globalStatuses = [];
  for (let index = 1; index <= 3; index += 1) {
    const response = await fetch(`http://127.0.0.1:${globalPort}/api/agent/interview`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${index}` }, body: payload });
    globalStatuses.push(response.status);
  }
  assert.deepEqual(globalStatuses, [200, 200, 429]);

  const boundedServer = createServer({ providerMode: "mock", trustProxy: true, rateLimitMax: 1, rateLimitMaxBuckets: 100, globalRateLimitMax: 10_000 }).listen(0, "127.0.0.1");
  await once(boundedServer, "listening");
  t.after(() => boundedServer.close());
  const boundedPort = boundedServer.address().port;
  for (let index = 1; index <= 101; index += 1) {
    const response = await fetch(`http://127.0.0.1:${boundedPort}/api/agent/interview`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${index}` }, body: payload });
    assert.equal(response.status, 200);
  }
  const evictedAddress = await fetch(`http://127.0.0.1:${boundedPort}/api/agent/interview`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.1" }, body: payload });
  assert.equal(evictedAddress.status, 200);
});

test("真实 AI 服务拒绝低强度共享访问码", async (t) => {
  const server = createServer({ providerMode: "openai-compatible", accessToken: "short-token" }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/agent/interview`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer short-token" },
    body: JSON.stringify({ campaignType: "product", idea: "新品", answers: [], brand: {} }),
  });
  assert.equal(response.status, 503);
});
