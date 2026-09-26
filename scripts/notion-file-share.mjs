#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import {
  DEFAULTS, buildPartPlan, captionText, defaultStatePath, evaluateRoutes,
  inferBlockType, inferMime, isTransient, normalizeNotionId, readJson,
  sha256File, writeJsonAtomic
} from "./lib/core.mjs";
import { resolveNotionCredentials } from "./lib/credentials.mjs";

const HELP = `Usage: node scripts/notion-file-share.mjs --file <path> [mode] [options]

Modes (choose at most one; default is dry-run):
  --preflight       Read-only page access and route-selector checks
  --apply           Upload, attach, persist state, and verify
  --verify-only     Verify the persisted destination block

Options:
  --page-id <id-or-url>          Override NOTION_PAGE_ID / Key Vault
  --vault-name <name>            Default: ${DEFAULTS.vaultName}
  --page-id-secret <name>        Default: ${DEFAULTS.pageIdSecret}
  --api-key-secret <name>        Default: ${DEFAULTS.apiKeySecret}
  --state <path>                 Durable resume-state path
  --caption <text>               Default: source filename
  --block-type <type>            auto, file, image, pdf, video, audio
  --part-mib <5..20>             Default: ${DEFAULTS.partMiB}
  --route-check <mode>           connections, selector, off
  --expected-chain <a>b>c>       Default: DIRECT>国内直连>Notion
  --resolve-ip <ip>              Requires --local-address
  --local-address <ip>           Requires --resolve-ip
  --clash-pipe <path>            Default: ${DEFAULTS.clashPipe}
  --clash-url <url>              Alternative HTTP controller
  --selector <name>              Default: Notion
  --direct-member <name>         Default: 国内直连
  --api-version <version>        Default: ${DEFAULTS.apiVersion}
`;

export function parseArgs(argv) {
  const options = {
    file: "", mode: "dry-run", pageId: "", state: "", caption: "", blockType: "auto",
    vaultName: process.env.NOTION_KEY_VAULT || DEFAULTS.vaultName,
    pageIdSecret: process.env.NOTION_PAGE_ID_SECRET || DEFAULTS.pageIdSecret,
    apiKeySecret: process.env.NOTION_API_KEY_SECRET || DEFAULTS.apiKeySecret,
    partMiB: DEFAULTS.partMiB, routeCheck: "connections",
    expectedChain: [...DEFAULTS.expectedChain], resolveIp: "", localAddress: "",
    clashPipe: process.env.CLASH_CONTROLLER_PIPE || DEFAULTS.clashPipe,
    clashUrl: process.env.CLASH_CONTROLLER_URL || "",
    clashSecret: process.env.CLASH_CONTROLLER_SECRET || "",
    selector: process.env.NOTION_ROUTE_SELECTOR || DEFAULTS.selector,
    directMember: process.env.NOTION_ROUTE_DIRECT_MEMBER || DEFAULTS.directMember,
    apiVersion: DEFAULTS.apiVersion
  };
  const valueKeys = new Map([
    ["--file", "file"], ["--page-id", "pageId"], ["--state", "state"], ["--caption", "caption"],
    ["--block-type", "blockType"], ["--vault-name", "vaultName"], ["--page-id-secret", "pageIdSecret"],
    ["--api-key-secret", "apiKeySecret"], ["--part-mib", "partMiB"], ["--route-check", "routeCheck"],
    ["--resolve-ip", "resolveIp"], ["--local-address", "localAddress"], ["--clash-pipe", "clashPipe"],
    ["--clash-url", "clashUrl"], ["--selector", "selector"], ["--direct-member", "directMember"],
    ["--api-version", "apiVersion"]
  ]);
  const modes = new Map([["--preflight", "preflight"], ["--apply", "apply"], ["--verify-only", "verify-only"]]);
  let chosenMode = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (modes.has(arg)) {
      if (chosenMode) throw new Error("Choose only one mode.");
      options.mode = modes.get(arg); chosenMode = true; continue;
    }
    if (arg === "--expected-chain") {
      const value = argv[++index]; if (!value) throw new Error("--expected-chain requires a value.");
      options.expectedChain = value.split(">").map(item => item.trim()).filter(Boolean); continue;
    }
    const key = valueKeys.get(arg);
    if (!key) throw new Error(`Unknown argument: ${arg}`);
    const value = argv[++index]; if (value == null) throw new Error(`${arg} requires a value.`);
    options[key] = key === "partMiB" ? Number(value) : value;
  }
  if (!options.file) throw new Error("--file is required.");
  options.file = path.resolve(options.file);
  if (!fs.existsSync(options.file) || !fs.statSync(options.file).isFile()) throw new Error(`File not found: ${options.file}`);
  if (!Number.isInteger(options.partMiB) || options.partMiB < 5 || options.partMiB > 20) throw new Error("--part-mib must be an integer from 5 through 20.");
  if (!["auto", "file", "image", "pdf", "video", "audio"].includes(options.blockType)) throw new Error("Unsupported --block-type.");
  if (!["connections", "selector", "off"].includes(options.routeCheck)) throw new Error("--route-check must be connections, selector, or off.");
  if (Boolean(options.resolveIp) !== Boolean(options.localAddress)) throw new Error("--resolve-ip and --local-address must be used together.");
  if (options.resolveIp && options.expectedChain.join(">") === DEFAULTS.expectedChain.join(">")) options.expectedChain = ["DIRECT"];
  return options;
}

function controllerRequest(options, pathname) {
  return new Promise((resolve, reject) => {
    const target = options.clashUrl ? new URL(pathname, options.clashUrl) : null;
    const client = target?.protocol === "https:" ? https : http;
    const request = client.request({
      ...(target ? { hostname: target.hostname, port: target.port, path: target.pathname + target.search } : { socketPath: options.clashPipe, path: pathname }),
      method: "GET",
      headers: { Accept: "application/json", ...(options.clashSecret ? { Authorization: `Bearer ${options.clashSecret}` } : {}) }
    }, response => {
      let text = ""; response.setEncoding("utf8"); response.on("data", chunk => { text += chunk; });
      response.on("end", () => {
        if ((response.statusCode ?? 500) >= 400) return reject(new Error(`Clash controller returned HTTP ${response.statusCode} for ${pathname}`));
        try { resolve(JSON.parse(text)); } catch { reject(new Error(`Clash controller returned invalid JSON for ${pathname}`)); }
      });
    });
    request.on("error", reject); request.end();
  });
}

async function assertSelector(options) {
  if (options.routeCheck === "off") return { checked: false };
  const proxies = (await controllerRequest(options, "/proxies"))?.proxies ?? {};
  const selector = proxies[options.selector];
  if (!selector || selector.type !== "Selector") throw new Error(`Required Clash selector is missing: ${options.selector}`);
  if (selector.now !== options.directMember) throw new Error(`Notion route rejected: expected ${options.selector} -> ${options.directMember}, observed ${selector.now ?? "(none)"}.`);
  return { checked: true, selector: options.selector, selected: selector.now };
}

async function currentConnections(options, startedAt) {
  const payload = await controllerRequest(options, "/connections");
  return (payload?.connections ?? []).filter(connection => {
    const metadata = connection.metadata ?? {};
    const started = Date.parse(connection.start ?? "");
    const target = metadata.host === DEFAULTS.apiHost || (options.resolveIp && metadata.destinationIP === options.resolveIp);
    const nodeProcess = !metadata.process || /node(?:\.exe)?$/iu.test(String(metadata.process));
    return target && nodeProcess && (!Number.isFinite(started) || started >= startedAt - 2000);
  }).map(connection => ({ id: connection.id, chains: connection.chains ?? [], uploadedBytes: connection.upload ?? 0 }));
}

class NotionApi {
  constructor(options, token) { this.options = options; this.token = token; this.lastRequest = 0; }
  async limit() { const wait = 1000 - (Date.now() - this.lastRequest); if (wait > 0) await sleep(wait); this.lastRequest = Date.now(); }
  async request(method, pathname, { json, body, headers = {}, sampleRoute = false, retry = true } = {}) {
    const attempts = retry ? 4 : 1;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      await this.limit();
      try { return await this.raw(method, pathname, { json, body, headers, sampleRoute }); }
      catch (error) {
        if (attempt >= attempts || !isTransient(error)) throw error;
        const retryAfter = Number(error.retryAfter);
        const delay = Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000 * (2 ** (attempt - 1));
        await sleep(delay + Math.floor(Math.random() * 500));
      }
    }
  }
  async raw(method, pathname, { json, body, headers, sampleRoute }) {
    const payload = json == null ? body : Buffer.from(JSON.stringify(json));
    const startedAt = Date.now(); let sampling = Boolean(sampleRoute); let observed = [];
    const sampler = sampling ? (async () => {
      while (sampling) {
        try {
          const items = await currentConnections(this.options, startedAt);
          const known = new Map(observed.map(item => [item.id, item]));
          for (const item of items) known.set(item.id, item); observed = [...known.values()];
        } catch { /* fail closed after transfer */ }
        if (sampling) await sleep(200);
      }
    })() : null;
    try {
      const result = await new Promise((resolve, reject) => {
        const request = https.request({
          hostname: DEFAULTS.apiHost, port: 443, path: pathname, method,
          localAddress: this.options.localAddress || undefined,
          lookup: this.options.resolveIp ? ((_hostname, lookupOptions, callback) => {
            if (lookupOptions?.all) callback(null, [{ address: this.options.resolveIp, family: 4 }]);
            else callback(null, this.options.resolveIp, 4);
          }) : undefined,
          headers: {
            Authorization: `Bearer ${this.token}`, "Notion-Version": this.options.apiVersion,
            Accept: "application/json", ...(json != null ? { "Content-Type": "application/json" } : {}),
            ...(payload ? { "Content-Length": payload.length } : {}), ...headers
          }
        }, response => {
          const chunks = []; response.on("data", chunk => chunks.push(chunk));
          response.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8"); let data = null;
            try { data = text ? JSON.parse(text) : null; } catch { data = text; }
            if ((response.statusCode ?? 500) >= 400) {
              const error = new Error(`Notion ${method} ${pathname} returned HTTP ${response.statusCode}: ${typeof data === "string" ? data.slice(0, 500) : data?.message ?? "request failed"}`);
              error.status = response.statusCode; error.body = text.slice(0, 1000); error.retryAfter = response.headers["retry-after"]; reject(error); return;
            }
            resolve({ data, status: response.statusCode ?? 0 });
          });
        });
        request.setTimeout(600000, () => request.destroy(Object.assign(new Error("Notion request timed out."), { code: "ETIMEDOUT" })));
        request.on("error", reject); if (payload) request.write(payload); request.end();
      });
      return { ...result, connections: observed };
    } catch (error) { error.connections = observed; throw error; }
    finally { sampling = false; if (sampler) await sampler; }
  }
}

async function readPart(filePath, offset, length) {
  const handle = await fs.promises.open(filePath, "r");
  try { const buffer = Buffer.allocUnsafe(length); const result = await handle.read(buffer, 0, length, offset); return buffer.subarray(0, result.bytesRead); }
  finally { await handle.close(); }
}

function multipartBody(buffer, filename, mime, partNumber) {
  const boundary = `----notion-file-sharing-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const fields = partNumber == null ? "" : `--${boundary}\r\nContent-Disposition: form-data; name="part_number"\r\n\r\n${partNumber}\r\n`;
  const safeName = filename.replace(/["\r\n]/gu, "_");
  const head = Buffer.from(`${fields}--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\nContent-Type: ${mime}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, buffer, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function listChildren(api, pageId) {
  const blocks = []; let cursor = "";
  do {
    const suffix = cursor ? `?page_size=100&start_cursor=${encodeURIComponent(cursor)}` : "?page_size=100";
    const response = await api.request("GET", `/v1/blocks/${pageId}/children${suffix}`);
    blocks.push(...(response.data?.results ?? [])); cursor = response.data?.has_more ? response.data?.next_cursor : "";
  } while (cursor);
  return blocks;
}

async function verifyBlock(api, state) {
  if (!state.attachment?.blockId) throw new Error("State has no attached block ID to verify.");
  const block = (await api.request("GET", `/v1/blocks/${state.attachment.blockId}`)).data;
  if (block?.archived || block?.in_trash) throw new Error("Destination block is archived or in trash.");
  if (block?.type !== state.file.blockType) throw new Error(`Block type mismatch: expected ${state.file.blockType}, observed ${block?.type}.`);
  if (captionText(block) !== state.attachment.caption) throw new Error("Destination caption does not match state.");
  const parentId = block?.parent?.page_id || block?.parent?.block_id;
  if (parentId && normalizeNotionId(parentId) !== state.target.pageId) throw new Error("Destination block parent does not match the target page.");
  state.attachment.status = "verified"; state.attachment.verifiedAt = new Date().toISOString(); state.updatedAt = state.attachment.verifiedAt;
  writeJsonAtomic(state.statePath, state);
  return { pageId: state.target.pageId, blockId: block.id, type: block.type, caption: captionText(block) };
}

async function main() {
  const options = parseArgs(process.argv.slice(2)); if (options.help) { console.log(HELP); return; }
  const stat = fs.statSync(options.file); const sha256 = await sha256File(options.file); const plan = buildPartPlan(stat.size, options.partMiB);
  const blockType = inferBlockType(options.file, options.blockType); const mime = inferMime(options.file); const caption = options.caption || path.basename(options.file);
  const needToken = options.mode !== "dry-run"; const { pageId, token } = resolveNotionCredentials(options, needToken);
  const statePath = path.resolve(options.state || defaultStatePath(options.file, sha256));
  const summary = { mode: options.mode, file: options.file, bytes: stat.size, sha256, pageId, blockType, mime, partCount: plan.count, partMiB: options.partMiB, statePath };
  if (options.mode === "dry-run") { console.log(JSON.stringify(summary, null, 2)); return; }
  const api = new NotionApi(options, token);
  const route = await assertSelector(options);
  await api.request("GET", `/v1/pages/${pageId}`);
  if (options.mode === "preflight") { console.log(JSON.stringify({ ...summary, pageAccess: "verified", route }, null, 2)); return; }

  let state = fs.existsSync(statePath) ? readJson(statePath) : null;
  if (state) {
    if (state.file?.sha256 !== sha256 || state.file?.bytes !== stat.size || state.target?.pageId !== pageId) throw new Error("Existing state does not match the file hash, size, and target page.");
    state.statePath = statePath;
  } else {
    state = {
      schemaVersion: 1, statePath, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      target: { pageId }, file: { path: options.file, name: path.basename(options.file), bytes: stat.size, sha256, mime, blockType },
      plan: { mode: plan.mode, partBytes: plan.partBytes, partCount: plan.count }, uploadHistory: [], upload: null, attachment: null
    };
    writeJsonAtomic(statePath, state);
  }
  if (options.mode === "verify-only") { console.log(JSON.stringify({ ...summary, verification: await verifyBlock(api, state) }, null, 2)); return; }
  if (state.attachment?.blockId) { console.log(JSON.stringify({ ...summary, resumed: true, verification: await verifyBlock(api, state) }, null, 2)); return; }

  if (state.upload?.id) {
    const remote = (await api.request("GET", `/v1/file_uploads/${state.upload.id}`)).data;
    state.upload.status = remote.status;
    const sent = Number(remote?.number_of_parts?.sent ?? 0);
    state.upload.sentParts = Array.from({ length: Math.max(sent, state.upload.sentParts?.length ?? 0) }, (_, index) => index + 1);
    state.updatedAt = new Date().toISOString(); writeJsonAtomic(statePath, state);
  }
  const expired = state.upload?.expiryTime && Date.parse(state.upload.expiryTime) <= Date.now() + 300000;
  if (!state.upload || (expired && state.upload.status !== "uploaded")) {
    if (state.upload) state.uploadHistory.push({ ...state.upload, replacedAt: new Date().toISOString(), reason: "expired" });
    const payload = { mode: plan.mode, filename: state.file.name, content_type: mime, ...(plan.mode === "multi_part" ? { number_of_parts: plan.count } : {}) };
    const created = (await api.request("POST", "/v1/file_uploads", { json: payload })).data;
    state.upload = { id: created.id, status: created.status, expiryTime: created.expiry_time, sentParts: [] };
    state.updatedAt = new Date().toISOString(); writeJsonAtomic(statePath, state);
  }

  if (state.upload.status !== "uploaded") {
    for (const part of plan.parts) {
      if (state.upload.sentParts.includes(part.number)) continue;
      await assertSelector(options);
      const buffer = await readPart(options.file, part.offset, part.length);
      const form = multipartBody(buffer, state.file.name, mime, plan.mode === "multi_part" ? part.number : null);
      let sent = false;
      for (let attempt = 1; attempt <= 4 && !sent; attempt += 1) {
        try {
          const result = await api.request("POST", `/v1/file_uploads/${state.upload.id}/send`, { body: form.body, headers: { "Content-Type": form.contentType }, sampleRoute: options.routeCheck === "connections", retry: false });
          state.upload.sentParts.push(part.number); state.upload.sentParts.sort((a, b) => a - b); state.updatedAt = new Date().toISOString(); writeJsonAtomic(statePath, state);
          if (options.routeCheck === "connections") {
            const verdict = evaluateRoutes(result.connections, options.expectedChain);
            if (!verdict.accepted && part.length >= 5 * 1024 * 1024) throw Object.assign(new Error(`Notion upload route rejected: ${verdict.reason}; observed ${JSON.stringify(verdict.observedChains)}.`), { routeRejected: true });
          }
          sent = true;
        } catch (error) {
          if (error.routeRejected) throw error;
          const remote = (await api.request("GET", `/v1/file_uploads/${state.upload.id}`)).data;
          const accepted = Number(remote?.number_of_parts?.sent ?? 0) >= part.number || remote?.status === "uploaded";
          if (accepted) {
            state.upload.sentParts.push(part.number); state.upload.sentParts = [...new Set(state.upload.sentParts)].sort((a, b) => a - b);
            state.updatedAt = new Date().toISOString(); writeJsonAtomic(statePath, state); sent = true; break;
          }
          if (!isTransient(error) || attempt === 4) throw error;
          await sleep(1000 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 500));
        }
      }
    }
    if (plan.mode === "multi_part") await api.request("POST", `/v1/file_uploads/${state.upload.id}/complete`, { json: {} });
    state.upload.status = "uploaded"; state.updatedAt = new Date().toISOString(); writeJsonAtomic(statePath, state);
  }

  const matches = (await listChildren(api, pageId)).filter(block => captionText(block) === caption);
  if (matches.length) throw new Error(`A block with caption ${JSON.stringify(caption)} already exists on the target page but is not linked to this verified state. Review it before retrying.`);
  const fileValue = { type: "file_upload", file_upload: { id: state.upload.id }, caption: [{ type: "text", text: { content: caption } }] };
  const appended = (await api.request("PATCH", `/v1/blocks/${pageId}/children`, { json: { children: [{ object: "block", type: blockType, [blockType]: fileValue }] } })).data;
  const block = appended?.results?.[0]; if (!block?.id) throw new Error("Notion did not return the appended block ID.");
  state.attachment = { blockId: block.id, caption, status: "attached", attachedAt: new Date().toISOString() };
  state.updatedAt = new Date().toISOString(); writeJsonAtomic(statePath, state);
  console.log(JSON.stringify({ ...summary, verification: await verifyBlock(api, state) }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error?.stack ?? error); process.exitCode = 1; });
}
