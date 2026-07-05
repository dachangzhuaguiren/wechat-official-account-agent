import http from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runAgentOperation } from "./lib/agent-core.mjs";

const backendDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(backendDir, "..");
const staticFiles = new Map([
  ["/", ["frontend/public/index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["frontend/public/index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["frontend/public/app.js", "text/javascript; charset=utf-8"]],
  ["/agent-core.js", ["backend/lib/agent-core.mjs", "text/javascript; charset=utf-8"]],
  ["/config.js", ["frontend/public/config.js", "text/javascript; charset=utf-8"]],
  ["/mock-agent.js", ["frontend/public/mock-agent.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["frontend/styles/globals.css", "text/css; charset=utf-8"]],
  ["/vendor/phosphor-regular.woff2", ["frontend/public/vendor/phosphor-regular.woff2", "font/woff2"]],
]);

function json(response, status, value, extraHeaders = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "x-frame-options": "DENY",
    ...extraHeaders,
  });
  response.end(JSON.stringify(value));
}

async function readJson(request, maxBytes = 1_000_000) {
  const declaredLength = Number(request.headers["content-length"] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    const error = new Error("请求内容过大");
    error.code = "PAYLOAD_TOO_LARGE";
    throw error;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      const error = new Error("请求内容过大");
      error.code = "PAYLOAD_TOO_LARGE";
      throw error;
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks, size).toString("utf8") || "{}");
  } catch {
    const error = new Error("请求 JSON 格式无效");
    error.code = "INVALID_JSON";
    throw error;
  }
}

function clientAddress(request, trustProxy) {
  if (trustProxy) {
    const forwarded = request.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) {
      const addresses = forwarded.split(",").map((value) => value.trim()).filter(Boolean);
      const nearestForwardedAddress = addresses.at(-1);
      if (nearestForwardedAddress && isIP(nearestForwardedAddress)) return nearestForwardedAddress;
    }
  }
  return request.socket.remoteAddress || "unknown";
}

function parseAllowedOrigins(value) {
  const origins = new Set();
  for (const item of String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean)) {
    let parsed;
    try { parsed = new URL(item); }
    catch { throw new Error(`ALLOWED_ORIGINS 包含无效 Origin: ${item}`); }
    if (!/^https?:$/.test(parsed.protocol) || parsed.origin !== item.replace(/\/$/, "") || parsed.username || parsed.password) {
      throw new Error(`ALLOWED_ORIGINS 必须是精确的 HTTP(S) Origin: ${item}`);
    }
    origins.add(parsed.origin);
  }
  return origins;
}

function requestOrigin(request, trustProxy) {
  const forwardedProtocol = trustProxy ? String(request.headers["x-forwarded-proto"] || "").split(",").at(-1)?.trim() : "";
  const protocol = ["http", "https"].includes(forwardedProtocol) ? forwardedProtocol : request.socket.encrypted ? "https" : "http";
  const host = String(request.headers.host || "").trim();
  if (!host) return "";
  try { return new URL(`${protocol}://${host}`).origin; }
  catch { return ""; }
}

function corsHeaders(request, allowedOrigins, trustProxy) {
  const origin = String(request.headers.origin || "").replace(/\/$/, "");
  if (!origin) return {};
  try {
    if (new URL(origin).origin === requestOrigin(request, trustProxy)) return {};
  } catch {
    return null;
  }
  if (!allowedOrigins.has(origin)) return null;
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

function bearerToken(request) {
  const match = String(request.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

function tokensEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function acceptsJson(request) {
  const mediaType = String(request.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

function isLoopbackAddress(value) {
  const address = String(value || "").toLowerCase();
  return address === "::1" || address.startsWith("127.") || address.startsWith("::ffff:127.");
}

function isLoopbackHost(value) {
  try {
    const hostname = new URL(`http://${String(value || "")}`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.");
  } catch {
    return false;
  }
}

function allowsLocalUnauthenticatedAgent(request, enabled, trustProxy) {
  return enabled && !trustProxy && isLoopbackAddress(request.socket.localAddress) && isLoopbackHost(request.headers.host);
}

function pruneRateBuckets(buckets, now, windowMs, maxBuckets) {
  for (const [key, bucket] of buckets) {
    if (now - bucket.startedAt >= windowMs) buckets.delete(key);
  }
  while (buckets.size >= maxBuckets) buckets.delete(buckets.keys().next().value);
}

function boundedNumber(value, fallback, { min, max }) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.floor(parsed), max));
}

export function createServer(options = {}) {
  const agentEnv = options.agentEnv ?? process.env;
  const rateLimitMax = boundedNumber(options.rateLimitMax ?? agentEnv.RATE_LIMIT_MAX, 30, { min: 1, max: 10_000 });
  const rateLimitWindowMs = boundedNumber(options.rateLimitWindowMs ?? agentEnv.RATE_LIMIT_WINDOW_MS, 60_000, { min: 1_000, max: 3_600_000 });
  const rateLimitMaxBuckets = boundedNumber(options.rateLimitMaxBuckets ?? agentEnv.RATE_LIMIT_MAX_BUCKETS, 5_000, { min: 100, max: 100_000 });
  const globalRateLimitMax = boundedNumber(options.globalRateLimitMax ?? agentEnv.GLOBAL_RATE_LIMIT_MAX, Math.max(rateLimitMax * 20, 200), { min: rateLimitMax, max: 1_000_000 });
  const trustProxy = options.trustProxy ?? agentEnv.TRUST_PROXY === "1";
  const providerMode = options.providerMode ?? agentEnv.AGENT_PROVIDER_MODE ?? "mock";
  const accessToken = String(options.accessToken ?? agentEnv.AGENT_ACCESS_TOKEN ?? "");
  const allowUnauthenticatedAgent = options.allowUnauthenticatedAgent ?? agentEnv.ALLOW_UNAUTHENTICATED_AGENT === "1";
  const exposeHealthDetails = options.exposeHealthDetails ?? agentEnv.EXPOSE_HEALTH_DETAILS === "1";
  const allowedOrigins = parseAllowedOrigins(options.allowedOrigins ?? agentEnv.ALLOWED_ORIGINS);
  const operationEnv = options.providerMode === undefined ? agentEnv : { ...agentEnv, AGENT_PROVIDER_MODE: providerMode };
  const requestsByAddress = new Map();
  let globalBucket = { startedAt: 0, count: 0 };

  return http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://localhost");
    const apiRequest = url.pathname.startsWith("/api/");
    const cors = apiRequest ? corsHeaders(request, allowedOrigins, trustProxy) : {};
    if (apiRequest && cors === null) return json(response, 403, { error: "请求来源不允许" });

    if (request.method === "OPTIONS" && apiRequest) {
      response.writeHead(204, { ...cors, "cache-control": "no-store" });
      return response.end();
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      return json(response, 200, exposeHealthDetails ? { ok: true, providerMode, accessProtected: accessToken.length >= 32 } : { ok: true }, cors);
    }

    const operation = url.pathname.match(/^\/api\/agent\/(interview|directions|draft|rewrite|audit)$/)?.[1];
    if (request.method === "POST" && operation) {
      const now = Date.now();
      if (!globalBucket.startedAt || now - globalBucket.startedAt >= rateLimitWindowMs) globalBucket = { startedAt: now, count: 0 };
      globalBucket.count += 1;
      if (Number.isFinite(globalRateLimitMax) && globalRateLimitMax > 0 && globalBucket.count > globalRateLimitMax) {
        const retryAfter = Math.max(1, Math.ceil((rateLimitWindowMs - (now - globalBucket.startedAt)) / 1000));
        return json(response, 429, { error: "服务请求过于频繁，请稍后重试" }, { ...cors, "retry-after": String(retryAfter) });
      }
      const address = clientAddress(request, trustProxy);
      const current = requestsByAddress.get(address);
      const bucket = !current || now - current.startedAt >= rateLimitWindowMs
        ? { startedAt: now, count: 0 }
        : current;
      bucket.count += 1;
      if (!current && requestsByAddress.size >= rateLimitMaxBuckets) pruneRateBuckets(requestsByAddress, now, rateLimitWindowMs, rateLimitMaxBuckets);
      requestsByAddress.delete(address);
      requestsByAddress.set(address, bucket);

      if (Number.isFinite(rateLimitMax) && rateLimitMax > 0 && bucket.count > rateLimitMax) {
        const retryAfter = Math.max(1, Math.ceil((rateLimitWindowMs - (now - bucket.startedAt)) / 1000));
        return json(response, 429, { error: "请求过于频繁，请稍后重试" }, { ...cors, "retry-after": String(retryAfter) });
      }

      const localUnauthenticatedAgent = allowsLocalUnauthenticatedAgent(request, allowUnauthenticatedAgent, trustProxy);
      if (providerMode !== "mock" && !accessToken && !localUnauthenticatedAgent) {
        return json(response, 503, { error: "真实 AI 服务尚未完成访问保护配置" }, cors);
      }
      if (providerMode !== "mock" && accessToken && accessToken.length < 32) {
        return json(response, 503, { error: "真实 AI 服务访问码强度不足" }, cors);
      }
      if (accessToken && !tokensEqual(bearerToken(request), accessToken)) {
        return json(response, 401, { error: "访问码无效" }, { ...cors, "www-authenticate": "Bearer" });
      }
      if (!acceptsJson(request)) return json(response, 415, { error: "仅支持 application/json 请求" }, cors);

      try {
        return json(response, 200, await runAgentOperation(operation, await readJson(request), operationEnv), cors);
      } catch (error) {
        const requestId = randomUUID();
        const status = error?.code === "PAYLOAD_TOO_LARGE" ? 413
          : ["INVALID_INPUT", "INVALID_JSON"].includes(error?.code) ? 400
            : error?.code === "CONFIG_ERROR" ? 503
              : error?.code === "PROVIDER_ERROR" ? 502
                : 500;
        console.error("Agent request failed", { requestId, operation, code: error?.code || "UNEXPECTED", name: error?.name || "Error" });
        const errorMessage = status < 500 && error instanceof Error ? error.message
          : status === 502 ? "AI 服务暂时不可用，请稍后重试"
            : status === 503 ? "AI 服务尚未完成配置"
              : "Agent 处理失败";
        return json(response, status, { error: errorMessage, requestId }, cors);
      }
    }

    const asset = staticFiles.get(url.pathname);
    if (request.method === "GET" && asset) {
      try {
        const body = await readFile(path.join(projectRoot, asset[0]));
        response.writeHead(200, {
          "content-type": asset[1],
          "cache-control": "no-cache",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
          "permissions-policy": "camera=(), microphone=(), geolocation=()",
          "content-security-policy": "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://api.deepseek.com",
        });
        return response.end(body);
      } catch {
        return json(response, 404, { error: "文件不存在" });
      }
    }

    return json(response, 404, { error: "页面不存在" });
  });
}

export async function loadLocalEnv() {
  try {
    const content = await readFile(path.join(projectRoot, ".env.local"), "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match || match[1].startsWith("#") || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await loadLocalEnv();
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "127.0.0.1";
  const server = createServer();
  server.listen(port, host, () => console.log(`公众号写作 Agent: http://${host}:${port}`));
  process.once("SIGTERM", () => server.close(() => process.exit(0)));
}
