import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const DEFAULTS = Object.freeze({
  apiVersion: "2026-03-11",
  apiHost: "api.notion.com",
  vaultName: "kv-boccaro-shared-e9219",
  pageIdSecret: "notion-shared-zone-page-id",
  apiKeySecret: "notion-shared-zone-api-key",
  partMiB: 20,
  maxFileBytes: 5_000_000_000,
  clashPipe: "\\\\.\\pipe\\verge-mihomo",
  selector: "Notion",
  directMember: "国内直连",
  expectedChain: ["DIRECT", "国内直连", "Notion"]
});

const MIME_BY_EXTENSION = Object.freeze({
  ".aac": "audio/aac", ".avi": "video/x-msvideo", ".csv": "text/csv",
  ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gif": "image/gif", ".heic": "image/heic", ".jpeg": "image/jpeg", ".jpg": "image/jpeg",
  ".json": "application/json", ".m4a": "audio/mp4", ".mkv": "video/x-matroska", ".mov": "video/quicktime",
  ".mp3": "audio/mpeg", ".mp4": "video/mp4", ".pdf": "application/pdf", ".png": "image/png",
  ".ppt": "application/vnd.ms-powerpoint", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".svg": "image/svg+xml", ".txt": "text/plain", ".wav": "audio/wav", ".webm": "video/webm",
  ".webp": "image/webp", ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip": "application/zip"
});

export function normalizeNotionId(value) {
  const compact = String(value ?? "").match(/[0-9a-f]{32}/iu)?.[0]?.toLowerCase();
  if (!compact) throw new Error("A valid 32-hex Notion page ID or URL is required.");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

export function inferMime(filePath) {
  return MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export function inferBlockType(filePath, requested = "auto") {
  if (requested !== "auto") return requested;
  const mime = inferMime(filePath);
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  return "file";
}

export function buildPartPlan(size, partMiB = DEFAULTS.partMiB) {
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error("File size must be a positive safe integer.");
  if (!Number.isInteger(partMiB) || partMiB < 5 || partMiB > 20) throw new Error("partMiB must be an integer from 5 through 20.");
  if (size > DEFAULTS.maxFileBytes) throw new Error(`File exceeds the supported Notion limit of ${DEFAULTS.maxFileBytes} bytes.`);
  const partBytes = partMiB * 1024 * 1024;
  const count = Math.ceil(size / partBytes);
  return {
    mode: count === 1 ? "single_part" : "multi_part",
    partBytes,
    count,
    parts: Array.from({ length: count }, (_, index) => ({
      number: index + 1,
      offset: index * partBytes,
      length: Math.min(partBytes, size - index * partBytes)
    }))
  };
}

function containsOrdered(actual, expected) {
  if (actual.length < expected.length) return false;
  for (let start = 0; start <= actual.length - expected.length; start += 1) {
    if (expected.every((item, offset) => actual[start + offset] === item)) return true;
  }
  return false;
}

export function evaluateRoutes(connections, expectedChain, forbidden = ["Match"]) {
  const observedChains = (connections ?? []).map(item => item?.chains?.map(String) ?? []).filter(items => items.length);
  const rejected = observedChains.filter(chain => forbidden.some(name => chain.includes(name)) || !containsOrdered(chain, expectedChain));
  const matching = observedChains.filter(chain => containsOrdered(chain, expectedChain) && !forbidden.some(name => chain.includes(name)));
  return {
    expectedChain,
    observedChains,
    matchingChains: matching,
    rejectedChains: rejected,
    accepted: matching.length > 0 && rejected.length === 0,
    reason: observedChains.length === 0 ? "no_route_evidence" : matching.length === 0 ? "expected_chain_not_observed" : rejected.length ? "mixed_or_forbidden_route" : "accepted"
  };
}

export function isTransient(error) {
  const status = Number(error?.status);
  if ([408, 429, 500, 502, 503, 504, 520, 522, 524, 529].includes(status)) return true;
  const code = error?.code ?? error?.cause?.code;
  if (["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"].includes(code)) return true;
  const message = `${error?.message ?? ""} ${error?.body ?? ""}`;
  if (status === 409 && /failed to (?:upload file|finalize (?:the )?multi-part file upload).*try again later/iu.test(message)) return true;
  return /fetch failed|socket hang up|connection reset|timed out|timeout occurred|bad gateway/iu.test(message);
}

export async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

export function defaultStatePath(filePath, sha256, cwd = process.cwd()) {
  const safe = path.basename(filePath).replace(/[^A-Za-z0-9._-]+/gu, "-").slice(0, 100);
  return path.join(cwd, ".notion-file-sharing", `${safe}-${sha256.slice(0, 12)}.json`);
}

export function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temp, filePath);
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/u, ""));
}

export function captionText(block) {
  const value = block?.[block?.type]?.caption;
  return Array.isArray(value) ? value.map(item => item?.plain_text ?? item?.text?.content ?? "").join("") : "";
}
