import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
export function transportUrl(relative) {
  const root = process.env.NOTION_ATTACHMENT_TRANSFER_ROOT || path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "skills", "notion-attachment-transfer");
  return pathToFileURL(path.join(root, "scripts", relative)).href;
}
export async function loadTransport(relative) {
  try { return await import(transportUrl(relative)); }
  catch (error) { throw new Error("Install notion-attachment-transfer with its own npm ci, or set NOTION_ATTACHMENT_TRANSFER_ROOT.", { cause: error }); }
}
