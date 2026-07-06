export const DEFAULT_BRAND = Object.freeze({
  companyName: "",
  summary: "",
  targetAudience: "",
  tone: "专业、清晰、有温度",
  keyPoints: "",
  forbiddenTerms: "最、第一、绝对、百分百",
  defaultCta: "了解详情或预约体验",
  primaryColor: "#0f766e",
  accentColor: "#2563eb",
});

const PROJECT_STATUSES = new Set(["idea", "interview", "brief", "directions", "draft"]);
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const IDENTIFIER = /^[a-z0-9][a-z0-9_-]{0,99}$/i;
const DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i;

function invalid(message) {
  const error = new Error(message);
  error.code = "INVALID_BACKUP";
  throw error;
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label} 格式无效`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(`${label} 必须是普通对象`);
  return value;
}

function allowedKeys(value, keys, label) {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key))) invalid(`${label} 包含不允许的字段`);
}

function text(value, label, { min = 0, max }) {
  if (typeof value !== "string" || value.trim().length < min || value.length > max) invalid(`${label} 长度或格式无效`);
  return value;
}

function optionalText(value, label, options) {
  return value === undefined ? undefined : text(value, label, options);
}

function identifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) invalid(`${label} 格式无效`);
  return value;
}

function dateText(value, label) {
  const result = text(value, label, { min: 1, max: 64 });
  if (!Number.isFinite(Date.parse(result))) invalid(`${label} 日期无效`);
  return result;
}

function stringList(value, label, { max = 20, itemMax = 2000 } = {}) {
  if (!Array.isArray(value) || value.length > max) invalid(`${label} 数量无效`);
  return value.map((item, index) => text(item, `${label} ${index + 1}`, { min: 1, max: itemMax }));
}

function normalizeBrand(value) {
  const brand = plainObject(value, "品牌档案");
  const stringFields = ["companyName", "summary", "targetAudience", "tone", "keyPoints", "forbiddenTerms", "defaultCta"];
  allowedKeys(brand, [...stringFields, "primaryColor", "accentColor"], "品牌档案");
  const result = {};
  for (const field of stringFields) result[field] = text(brand[field] ?? DEFAULT_BRAND[field], `品牌档案 ${field}`, { max: 4000 });
  for (const field of ["primaryColor", "accentColor"]) {
    const color = brand[field] ?? DEFAULT_BRAND[field];
    if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) invalid(`品牌档案 ${field} 格式无效`);
    result[field] = color.toLowerCase();
  }
  return result;
}

function normalizeBrief(value, label = "营销简报") {
  const brief = plainObject(value, label);
  allowedKeys(brief, ["campaignType", "subject", "audience", "objective", "keyMessage", "proofPoints", "cta", "eventDetails", "restrictions", "missingFacts"], label);
  if (!["product", "event"].includes(brief.campaignType)) invalid(`${label} 宣传类型无效`);
  return {
    campaignType: brief.campaignType,
    subject: text(brief.subject, `${label}主题`, { min: 1, max: 4000 }),
    audience: text(brief.audience, `${label}目标读者`, { min: 1, max: 4000 }),
    objective: text(brief.objective, `${label}传播目标`, { min: 1, max: 4000 }),
    keyMessage: text(brief.keyMessage, `${label}核心信息`, { min: 1, max: 4000 }),
    proofPoints: stringList(brief.proofPoints, `${label}事实依据`),
    cta: text(brief.cta, `${label}行动指令`, { min: 1, max: 4000 }),
    eventDetails: text(brief.eventDetails, `${label}活动信息`, { min: 1, max: 4000 }),
    restrictions: stringList(brief.restrictions, `${label}限制`),
    missingFacts: stringList(brief.missingFacts, `${label}待补事实`),
  };
}

function normalizeQuestion(value, label) {
  const question = plainObject(value, label);
  allowedKeys(question, ["id", "text", "hint"], label);
  return {
    id: identifier(question.id, `${label}编号`),
    text: text(question.text, `${label}正文`, { min: 1, max: 1000 }),
    hint: text(question.hint ?? "", `${label}提示`, { max: 1000 }),
  };
}

function normalizeDirection(value, index) {
  const label = `内容方向 ${index + 1}`;
  const direction = plainObject(value, label);
  allowedKeys(direction, ["id", "title", "angle", "outline"], label);
  return {
    id: identifier(direction.id, `${label}编号`),
    title: text(direction.title, `${label}标题`, { min: 1, max: 500 }),
    angle: text(direction.angle, `${label}角度`, { min: 1, max: 500 }),
    outline: stringList(direction.outline, `${label}提纲`, { max: 10, itemMax: 1000 }),
  };
}

function normalizeProject(value, index) {
  const label = `项目 ${index + 1}`;
  const project = plainObject(value, label);
  allowedKeys(project, ["id", "title", "campaignType", "idea", "status", "messages", "answers", "directions", "articleHtml", "versions", "assets", "auditIssues", "createdAt", "updatedAt", "pendingQuestion", "brief", "selectedDirectionId"], label);
  if (!["product", "event"].includes(project.campaignType)) invalid(`${label}宣传类型无效`);
  if (!PROJECT_STATUSES.has(project.status)) invalid(`${label}状态无效`);

  const messages = Array.isArray(project.messages) ? project.messages : [];
  if (messages.length > 50) invalid(`${label}消息数量无效`);
  const normalizedMessages = messages.map((item, messageIndex) => {
    const messageLabel = `${label}消息 ${messageIndex + 1}`;
    const message = plainObject(item, messageLabel);
    allowedKeys(message, ["id", "role", "text", "createdAt"], messageLabel);
    if (!["agent", "user"].includes(message.role)) invalid(`${messageLabel}角色无效`);
    return { id: identifier(message.id, `${messageLabel}编号`), role: message.role, text: text(message.text, `${messageLabel}正文`, { min: 1, max: 4000 }), createdAt: dateText(message.createdAt, `${messageLabel}时间`) };
  });

  const answers = Array.isArray(project.answers) ? project.answers : [];
  if (answers.length > 8) invalid(`${label}回答数量无效`);
  const normalizedAnswers = answers.map((item, answerIndex) => {
    const answerLabel = `${label}回答 ${answerIndex + 1}`;
    const answer = plainObject(item, answerLabel);
    allowedKeys(answer, ["questionId", "question", "answer"], answerLabel);
    return {
      questionId: identifier(answer.questionId, `${answerLabel}问题编号`),
      question: text(answer.question, `${answerLabel}问题`, { min: 1, max: 1000 }),
      answer: text(answer.answer, `${answerLabel}正文`, { min: 1, max: 4000 }),
    };
  });

  const directions = Array.isArray(project.directions) ? project.directions : [];
  if (![0, 3].includes(directions.length)) invalid(`${label}内容方向数量无效`);
  const normalizedDirections = directions.map(normalizeDirection);
  const directionIds = new Set(normalizedDirections.map((item) => item.id));
  if (directionIds.size !== normalizedDirections.length) invalid(`${label}内容方向编号重复`);

  const versions = Array.isArray(project.versions) ? project.versions : [];
  if (versions.length > 10) invalid(`${label}历史版本数量无效`);
  const normalizedVersions = versions.map((item, versionIndex) => {
    const versionLabel = `${label}版本 ${versionIndex + 1}`;
    const version = plainObject(item, versionLabel);
    allowedKeys(version, ["id", "html", "reason", "createdAt"], versionLabel);
    return { id: identifier(version.id, `${versionLabel}编号`), html: text(version.html, `${versionLabel}正文`, { max: 200_000 }), reason: text(version.reason, `${versionLabel}原因`, { max: 1000 }), createdAt: dateText(version.createdAt, `${versionLabel}时间`) };
  });

  const assets = Array.isArray(project.assets) ? project.assets : [];
  if (assets.length > 8) invalid(`${label}图片数量无效`);
  const normalizedAssets = assets.map((item, assetIndex) => {
    const assetLabel = `${label}图片 ${assetIndex + 1}`;
    const asset = plainObject(item, assetLabel);
    allowedKeys(asset, ["id", "name", "mimeType", "dataUrl", "description", "createdAt"], assetLabel);
    if (!IMAGE_TYPES.has(asset.mimeType)) invalid(`${assetLabel}类型无效`);
    const dataUrl = text(asset.dataUrl, `${assetLabel}数据`, { min: 1, max: 2_800_000 });
    if (!DATA_URL.test(dataUrl) || !dataUrl.toLowerCase().startsWith(`data:${asset.mimeType};base64,`)) invalid(`${assetLabel}数据格式无效`);
    return { id: identifier(asset.id, `${assetLabel}编号`), name: text(asset.name, `${assetLabel}名称`, { min: 1, max: 255 }), mimeType: asset.mimeType, dataUrl, description: text(asset.description, `${assetLabel}描述`, { max: 2000 }), createdAt: dateText(asset.createdAt, `${assetLabel}时间`) };
  });

  const issues = Array.isArray(project.auditIssues) ? project.auditIssues : [];
  if (issues.length > 50) invalid(`${label}审核问题数量无效`);
  const normalizedIssues = issues.map((item, issueIndex) => {
    const issueLabel = `${label}审核问题 ${issueIndex + 1}`;
    const issue = plainObject(item, issueLabel);
    allowedKeys(issue, ["id", "severity", "message", "excerpt"], issueLabel);
    if (!["blocking", "warning"].includes(issue.severity)) invalid(`${issueLabel}级别无效`);
    return { id: identifier(issue.id, `${issueLabel}编号`), severity: issue.severity, message: text(issue.message, `${issueLabel}说明`, { min: 1, max: 2000 }), ...(issue.excerpt === undefined ? {} : { excerpt: text(issue.excerpt, `${issueLabel}原文`, { max: 4000 }) }) };
  });

  const brief = project.brief === undefined ? undefined : normalizeBrief(project.brief, `${label}营销简报`);
  const pendingQuestion = project.pendingQuestion === undefined ? undefined : normalizeQuestion(project.pendingQuestion, `${label}待回答问题`);
  const articleHtml = text(project.articleHtml ?? "", `${label}正文`, { max: 200_000 });
  const selectedDirectionId = optionalText(project.selectedDirectionId, `${label}已选方向`, { min: 1, max: 100 });
  if (selectedDirectionId !== undefined && (!IDENTIFIER.test(selectedDirectionId) || !directionIds.has(selectedDirectionId))) invalid(`${label}已选方向无效`);
  if (project.status === "interview" && !pendingQuestion) invalid(`${label}缺少待回答问题`);
  if (["brief", "directions", "draft"].includes(project.status) && !brief) invalid(`${label}缺少营销简报`);
  if (["directions", "draft"].includes(project.status) && normalizedDirections.length !== 3) invalid(`${label}缺少内容方向`);
  if (project.status === "draft" && !articleHtml.trim()) invalid(`${label}缺少正文`);

  return {
    id: identifier(project.id, `${label}编号`),
    title: text(project.title, `${label}名称`, { min: 1, max: 80 }),
    campaignType: project.campaignType,
    idea: text(project.idea, `${label}想法`, { min: 1, max: 4000 }),
    status: project.status,
    messages: normalizedMessages,
    answers: normalizedAnswers,
    directions: normalizedDirections,
    articleHtml,
    versions: normalizedVersions,
    assets: normalizedAssets,
    auditIssues: normalizedIssues,
    createdAt: dateText(project.createdAt, `${label}创建时间`),
    updatedAt: dateText(project.updatedAt, `${label}更新时间`),
    ...(pendingQuestion ? { pendingQuestion } : {}),
    ...(brief ? { brief } : {}),
    ...(selectedDirectionId ? { selectedDirectionId } : {}),
  };
}

export function createEmptyWorkspace() {
  return { schemaVersion: 1, brand: { ...DEFAULT_BRAND }, projects: [], activeProjectId: undefined };
}

export function normalizeWorkspaceBackup(value) {
  const workspace = plainObject(value, "备份文件");
  allowedKeys(workspace, ["schemaVersion", "brand", "projects", "activeProjectId"], "备份文件");
  if (workspace.schemaVersion !== 1) invalid("备份文件版本不受支持");
  if (!Array.isArray(workspace.projects) || workspace.projects.length > 100) invalid("备份文件项目数量无效");
  const projects = workspace.projects.map(normalizeProject);
  const projectIds = new Set(projects.map((project) => project.id));
  if (projectIds.size !== projects.length) invalid("备份文件包含重复项目编号");
  const activeProjectId = optionalText(workspace.activeProjectId, "当前项目编号", { min: 1, max: 100 });
  if (activeProjectId !== undefined && (!IDENTIFIER.test(activeProjectId) || !projectIds.has(activeProjectId))) invalid("当前项目编号无效");
  return { schemaVersion: 1, brand: normalizeBrand(workspace.brand), projects, activeProjectId };
}
