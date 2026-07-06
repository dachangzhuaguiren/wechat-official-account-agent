import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyWorkspace, normalizeWorkspaceBackup } from "../frontend/public/workspace-schema.js";
import { decryptBackup, encryptBackup, isEncryptedBackup } from "../frontend/public/backup-crypto.js";

const timestamp = "2026-07-06T08:00:00.000Z";

function validWorkspace() {
  const workspace = createEmptyWorkspace();
  workspace.projects.push({
    id: "safe-project-id",
    title: "安全测试项目",
    campaignType: "product",
    idea: "验证备份导入边界",
    status: "idea",
    messages: [],
    answers: [],
    directions: [],
    articleHtml: "",
    versions: [],
    assets: [],
    auditIssues: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  workspace.activeProjectId = "safe-project-id";
  return workspace;
}

test("备份 Schema 只保留经过深层验证的工作区", () => {
  const normalized = normalizeWorkspaceBackup(validWorkspace());
  assert.equal(normalized.projects[0].title, "安全测试项目");
  assert.equal(Object.getPrototypeOf(normalized.projects[0]), Object.prototype);
  assert.equal(normalized.activeProjectId, "safe-project-id");
});

test("备份导入拒绝属性注入、异常颜色、外部图片和未知字段", () => {
  const identifierInjection = validWorkspace();
  identifierInjection.projects[0].id = 'x" autofocus onfocus="alert(1)';
  identifierInjection.activeProjectId = identifierInjection.projects[0].id;
  assert.throws(() => normalizeWorkspaceBackup(identifierInjection), /编号.*无效|编号.*格式/);

  const colorInjection = validWorkspace();
  colorInjection.brand.primaryColor = '#fff" onfocus="alert(1)';
  assert.throws(() => normalizeWorkspaceBackup(colorInjection), /primaryColor/);

  const externalAsset = validWorkspace();
  externalAsset.projects[0].assets.push({ id: "asset-1", name: "图片", mimeType: "image/png", dataUrl: "https://attacker.example/track.png", description: "", createdAt: timestamp });
  assert.throws(() => normalizeWorkspaceBackup(externalAsset), /图片.*数据/);

  const unexpected = validWorkspace();
  unexpected.projects[0].role = "admin";
  assert.throws(() => normalizeWorkspaceBackup(unexpected), /不允许的字段/);
});

test("备份导入限制项目数量、文章长度和重复编号", () => {
  const tooMany = validWorkspace();
  tooMany.projects = Array.from({ length: 101 }, (_, index) => ({ ...tooMany.projects[0], id: `project-${index}` }));
  assert.throws(() => normalizeWorkspaceBackup(tooMany), /项目数量/);

  const tooLong = validWorkspace();
  tooLong.projects[0].articleHtml = "x".repeat(200_001);
  assert.throws(() => normalizeWorkspaceBackup(tooLong), /正文/);

  const duplicate = validWorkspace();
  duplicate.projects.push({ ...duplicate.projects[0] });
  assert.throws(() => normalizeWorkspaceBackup(duplicate), /重复项目编号/);
});

test("加密备份可恢复且错误密码和篡改内容会失败", async () => {
  const workspace = validWorkspace();
  const encrypted = await encryptBackup(workspace, "correct horse battery staple");
  assert.equal(isEncryptedBackup(encrypted), true);
  assert.deepEqual(await decryptBackup(encrypted, "correct horse battery staple"), workspace);
  await assert.rejects(decryptBackup(encrypted, "wrong password value"), /密码错误|文件已损坏/);

  const tampered = structuredClone(encrypted);
  tampered.data = `${tampered.data.slice(0, -4)}AAAA`;
  await assert.rejects(decryptBackup(tampered, "correct horse battery staple"), /密码错误|文件已损坏/);
});
