import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(projectRoot, "dist");
if (!outputDir.startsWith(`${projectRoot}${path.sep}`)) throw new Error("Pages 输出目录越界");

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await mkdir(path.join(outputDir, "vendor"), { recursive: true });

for (const [source, target] of [
  ["frontend/public/index.html", "index.html"],
  ["frontend/public/app.js", "app.js"],
  ["frontend/public/workspace-schema.js", "workspace-schema.js"],
  ["frontend/public/backup-crypto.js", "backup-crypto.js"],
  ["backend/lib/agent-core.mjs", "agent-core.js"],
  ["frontend/public/mock-agent.js", "mock-agent.js"],
  ["frontend/styles/globals.css", "styles.css"],
  ["frontend/public/vendor/phosphor-regular.woff2", "vendor/phosphor-regular.woff2"],
]) {
  await copyFile(path.join(projectRoot, source), path.join(outputDir, target));
}

const apiBaseUrl = String(process.env.AGENT_API_BASE_URL || "").replace(/\/$/, "");
const saasEnabled = process.env.SAAS_ENABLED === "1" && Boolean(apiBaseUrl);
let apiOrigin = "";
if (apiBaseUrl) {
  let parsedApiBaseUrl;
  try { parsedApiBaseUrl = new URL(apiBaseUrl); }
  catch { throw new Error("AGENT_API_BASE_URL 必须是有效的 HTTPS URL"); }
  if (parsedApiBaseUrl.protocol !== "https:") throw new Error("GitHub Pages 后端地址必须使用 HTTPS");
  apiOrigin = parsedApiBaseUrl.origin;
}
await writeFile(
  path.join(outputDir, "config.js"),
  `window.AGENT_CONFIG = Object.freeze(${JSON.stringify({ apiBaseUrl, saasEnabled })});\n`,
  "utf8",
);

let html = await readFile(path.join(outputDir, "index.html"), "utf8");
if (apiOrigin) {
  html = html.replace("connect-src 'self' https://api.deepseek.com", `connect-src 'self' https://api.deepseek.com ${apiOrigin}`);
  await writeFile(path.join(outputDir, "index.html"), html, "utf8");
}
if (!html.includes('./app.js') || !html.includes('./config.js') || !html.includes('./styles.css')) {
  throw new Error("GitHub Pages 产物必须使用相对资源路径");
}

for (const file of ["index.html", "app.js", "workspace-schema.js", "backup-crypto.js", "agent-core.js", "config.js"]) {
  const content = await readFile(path.join(outputDir, file), "utf8");
  if (/sk-[A-Za-z0-9_-]{20,}/.test(content)) throw new Error(`GitHub Pages 产物疑似包含 API Key: ${file}`);
}

await writeFile(path.join(outputDir, ".nojekyll"), "", "utf8");
console.log(`GitHub Pages artifact: ${outputDir}`);
