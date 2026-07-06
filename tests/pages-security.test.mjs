import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("GitHub Pages 使用严格 CSP 且不持久化任何访问密钥", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("../frontend/public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../frontend/public/app.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /connect-src 'self' https:\/\/api\.deepseek\.com/);
  assert.match(html, /script-src 'self'/);
  assert.doesNotMatch(app, /sessionStorage\.(?:setItem|getItem)\(["']deepseek-api-key/);
  assert.doesNotMatch(app, /sessionStorage\.(?:setItem|getItem)\(["']agent-access-token/);
  assert.match(app, /let deepSeekApiKey = ""/);
  assert.match(app, /let remoteAccessToken = ""/);
  assert.match(app, /window\.self !== window\.top/);
  assert.match(app, /normalizeWorkspaceBackup/);
  assert.match(app, /encryptBackup/);
});

test("Pages SaaS 构建只公开后端地址和开关并收紧连接来源", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const built = spawnSync(process.execPath, ["scripts/build-pages.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, AGENT_API_BASE_URL: "https://api.saas.example", SAAS_ENABLED: "1" },
  });
  assert.equal(built.status, 0, built.stderr);
  const [config, html] = await Promise.all([
    readFile(new URL("../dist/config.js", import.meta.url), "utf8"),
    readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
  ]);
  assert.match(config, /"apiBaseUrl":"https:\/\/api\.saas\.example"/);
  assert.match(config, /"saasEnabled":true/);
  assert.match(html, /connect-src 'self' https:\/\/api\.deepseek\.com https:\/\/api\.saas\.example/);
  assert.doesNotMatch(config, /AGENT_API_KEY|SAAS_BOOTSTRAP_ADMIN_EMAIL|sk-[A-Za-z0-9_-]{20,}/);
});
