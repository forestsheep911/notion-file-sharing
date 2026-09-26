#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULTS, isTransient, writeJsonAtomic } from "./lib/core.mjs";
import { resolveNotionCredentials } from "./lib/credentials.mjs";

const PRIVATE_TITLE = "共享文件｜私人库";
const PUBLIC_TITLE = "共享文件｜公开库";
const TYPE_OPTIONS = ["文档", "图片", "音频", "视频", "压缩包", "其他"];

const text = content => [{ type: "text", text: { content } }];
const select = (names, colors = []) => ({ select: { options: names.map((name, index) => ({ name, color: colors[index] ?? "default" })) } });

export const SHARED_ZONE_DATABASES = Object.freeze([
  {
    key: "private",
    title: PRIVATE_TITLE,
    description: "个人与工作中的共享文件记录。文件放在数据库记录页正文中；此库不得直接公开。",
    properties: {
      "名称": { title: {} },
      "资源 ID": { rich_text: {} },
      "类型": select(TYPE_OPTIONS, ["blue", "purple", "orange", "red", "yellow", "gray"]),
      "标签": { multi_select: { options: [] } },
      "简介": { rich_text: {} },
      "目标受众": select(["仅自己", "公开候选"], ["gray", "blue"]),
      "工作流状态": select(["草稿", "上传中", "待核验", "可用", "失败", "归档"], ["gray", "blue", "yellow", "green", "red", "brown"]),
      "公开批准": { checkbox: {} },
      "文件数": { number: { format: "number" } },
      "总字节": { number: { format: "number" } },
      "清单哈希": { rich_text: {} },
      "版本": { rich_text: {} },
      "来源 URL": { url: {} },
      "来源说明": { rich_text: {} },
      "上传核验时间": { date: {} },
      "公开记录": { url: {} },
      "有效期": { date: {} },
      "内部备注": { rich_text: {} },
      "创建时间": { created_time: {} },
      "更新时间": { last_edited_time: {} }
    }
  },
  {
    key: "public",
    title: PUBLIC_TITLE,
    description: "仅保存已经明确批准、可对外发布的共享文件记录；建库不等于公开页面。",
    properties: {
      "名称": { title: {} },
      "资源 ID": { rich_text: {} },
      "类型": select(TYPE_OPTIONS, ["blue", "purple", "orange", "red", "yellow", "gray"]),
      "标签": { multi_select: { options: [] } },
      "简介": { rich_text: {} },
      "版本": { rich_text: {} },
      "语言": { multi_select: { options: [
        { name: "中文", color: "red" }, { name: "英文", color: "blue" },
        { name: "日文", color: "purple" }, { name: "其他", color: "gray" }
      ] } },
      "文件数": { number: { format: "number" } },
      "总字节": { number: { format: "number" } },
      "发布时间": { date: {} },
      "更新说明": { rich_text: {} },
      "使用说明": { rich_text: {} },
      "有效期": { date: {} },
      "创建时间": { created_time: {} },
      "更新时间": { last_edited_time: {} }
    }
  }
]);

export function parseSchemaArgs(argv) {
  const options = { mode: "dry-run" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") options.mode = "apply";
    else if (arg === "--verify-only") options.mode = "verify-only";
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (["--page-id", "--vault-name", "--page-id-secret", "--api-key-secret", "--state"].includes(arg)) {
      const value = argv[++index];
      if (!value) throw new Error(`${arg} requires a value.`);
      options[{ "--page-id": "pageId", "--vault-name": "vaultName", "--page-id-secret": "pageIdSecret", "--api-key-secret": "apiKeySecret", "--state": "statePath" }[arg]] = value;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

export function compareSchema(actualProperties, expectedProperties) {
  const issues = [];
  const actualNames = Object.keys(actualProperties ?? {}).sort();
  const expectedNames = Object.keys(expectedProperties).sort();
  for (const name of expectedNames) {
    const expectedType = Object.keys(expectedProperties[name])[0];
    const actual = actualProperties?.[name];
    if (!actual) { issues.push(`missing property: ${name}`); continue; }
    if (actual.type !== expectedType) { issues.push(`${name}: expected ${expectedType}, got ${actual.type}`); continue; }
    const expectedOptions = expectedProperties[name]?.[expectedType]?.options?.map(option => option.name) ?? [];
    const actualOptions = actual?.[actual.type]?.options?.map(option => option.name) ?? [];
    for (const option of expectedOptions) if (!actualOptions.includes(option)) issues.push(`${name}: missing option ${option}`);
  }
  for (const name of actualNames) if (!expectedNames.includes(name)) issues.push(`unexpected property: ${name}`);
  return issues;
}

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

class NotionClient {
  constructor(token) { this.token = token; this.lastRequestAt = 0; }

  async request(method, endpoint, body) {
    const maxAttempts = method === "GET" ? 4 : 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const delay = Math.max(0, 1000 - (Date.now() - this.lastRequestAt));
        if (delay) await sleep(delay);
        this.lastRequestAt = Date.now();
        const response = await fetch(`https://${DEFAULTS.apiHost}${endpoint}`, {
          method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Notion-Version": DEFAULTS.apiVersion,
            "Content-Type": "application/json"
          },
          body: body === undefined ? undefined : JSON.stringify(body)
        });
        const raw = await response.text();
        let value;
        try { value = raw ? JSON.parse(raw) : {}; } catch { value = { raw }; }
        if (response.ok) return value;
        const error = new Error(`Notion ${method} ${endpoint} failed (${response.status}): ${value?.message ?? raw}`);
        error.status = response.status;
        error.retryAfterMs = Math.max(0, Number(response.headers.get("retry-after") ?? 0) * 1000);
        throw error;
      } catch (error) {
        if (attempt === maxAttempts || !isTransient(error)) throw error;
        await sleep(Math.max(error.retryAfterMs ?? 0, 1000 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 250));
      }
    }
    throw new Error(`Notion ${method} ${endpoint} exhausted retries.`);
  }
}

async function listRootChildren(client, pageId) {
  const results = [];
  let cursor;
  do {
    const query = new URLSearchParams({ page_size: "100" });
    if (cursor) query.set("start_cursor", cursor);
    const page = await client.request("GET", `/v1/blocks/${pageId}/children?${query}`);
    results.push(...(page.results ?? []));
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return results;
}

async function inspectDatabase(client, databaseId, contract) {
  const database = await client.request("GET", `/v1/databases/${databaseId}`);
  const sources = database.data_sources ?? [];
  if (sources.length !== 1) throw new Error(`${contract.title} must have exactly one data source; found ${sources.length}.`);
  const dataSource = await client.request("GET", `/v1/data_sources/${sources[0].id}`);
  const issues = compareSchema(dataSource.properties, contract.properties);
  if (issues.length) throw new Error(`${contract.title} schema mismatch:\n- ${issues.join("\n- ")}`);
  return {
    databaseId: database.id,
    dataSourceId: dataSource.id,
    url: database.url,
    propertyCount: Object.keys(dataSource.properties ?? {}).length,
    verified: true
  };
}

async function createDatabase(client, rootPageId, contract) {
  return client.request("POST", "/v1/databases", {
    parent: { type: "page_id", page_id: rootPageId },
    title: text(contract.title),
    description: text(contract.description),
    is_inline: false,
    initial_data_source: { properties: contract.properties }
  });
}

function help() {
  return `Shared Zone schema initializer (default: read-only dry run)\n\n` +
    `  node scripts/shared-zone-schema.mjs\n` +
    `  node scripts/shared-zone-schema.mjs --apply\n` +
    `  node scripts/shared-zone-schema.mjs --verify-only\n\n` +
    `Options: --page-id --vault-name --page-id-secret --api-key-secret --state`;
}

export async function runSchema(options) {
  const { pageId, token } = resolveNotionCredentials(options, true);
  const client = new NotionClient(token);
  const children = await listRootChildren(client, pageId);
  const findings = SHARED_ZONE_DATABASES.map(contract => ({
    contract,
    matches: children.filter(block => block.type === "child_database" && block.child_database?.title === contract.title)
  }));
  for (const finding of findings) {
    if (finding.matches.length > 1) throw new Error(`Duplicate child databases named ${finding.contract.title}; refusing to choose.`);
    if (options.mode === "verify-only" && finding.matches.length === 0) throw new Error(`Missing child database: ${finding.contract.title}`);
  }

  if (options.mode === "dry-run") {
    return {
      mode: options.mode,
      rootPageId: pageId,
      childCount: children.length,
      plan: findings.map(({ contract, matches }) => ({ title: contract.title, action: matches.length ? "verify" : "create" }))
    };
  }

  const databases = {};
  for (const finding of findings) {
    let databaseId = finding.matches[0]?.id;
    let action = "reused";
    if (!databaseId) {
      const created = await createDatabase(client, pageId, finding.contract);
      databaseId = created.id;
      action = "created";
    }
    databases[finding.contract.key] = { action, ...(await inspectDatabase(client, databaseId, finding.contract)) };
  }

  const manifest = {
    schemaVersion: 1,
    verifiedAt: new Date().toISOString(),
    rootPageId: pageId,
    databases
  };
  const statePath = path.resolve(options.statePath ?? path.join(process.cwd(), ".notion-file-sharing", "shared-zone-schema.json"));
  writeJsonAtomic(statePath, manifest);
  return { mode: options.mode, statePath, ...manifest };
}

async function main() {
  const options = parseSchemaArgs(process.argv.slice(2));
  if (options.help) { console.log(help()); return; }
  const result = await runSchema(options);
  console.log(JSON.stringify(result, null, 2));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch(error => { console.error(error.message); process.exitCode = 1; });
