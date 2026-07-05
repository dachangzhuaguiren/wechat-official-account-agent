import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("GitHub Pages 使用严格 CSP 且不持久化 DeepSeek Key", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("../frontend/public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../frontend/public/app.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /connect-src 'self' https:\/\/api\.deepseek\.com/);
  assert.match(html, /script-src 'self'/);
  assert.doesNotMatch(app, /sessionStorage\.(?:setItem|getItem)\(["']deepseek-api-key/);
  assert.match(app, /let deepSeekApiKey = ""/);
  assert.match(app, /window\.self !== window\.top/);
});
