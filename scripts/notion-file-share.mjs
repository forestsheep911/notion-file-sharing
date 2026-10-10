#!/usr/bin/env node
// Shared Zone defaults and compatibility only; transport lives in the attachment skill.
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { loadTransport } from "./lib/transport.mjs";
const { main: transfer, parseArgs: parseTransport } = await loadTransport("notion-file-share.mjs");
function sharedArgs(args) {
 const result = [...args];
 if (!args.includes("--vault-name") && !process.env.NOTION_KEY_VAULT) result.push("--vault-name", "kv-boccaro-shared-e9219");
 if (!args.includes("--api-key-secret") && !process.env.NOTION_API_KEY_SECRET && !process.env.NOTION_API_KEY) result.push("--api-key-secret", "notion-shared-zone-api-key");
 if (!args.includes("--page-id") && !args.includes("--page-id-secret") && !process.env.NOTION_PAGE_ID && !process.env.NOTION_PAGE_ID_SECRET) result.push("--page-id-secret", "notion-shared-zone-page-id");
 return result;
}
export function parseArgs(args) { return parseTransport(sharedArgs(args)); }
export async function main(args = process.argv.slice(2)) { return transfer(sharedArgs(args)); }
if (process.argv[1] && fs.existsSync(process.argv[1]) && pathToFileURL(fs.realpathSync(process.argv[1])).href.toLowerCase() === import.meta.url.toLowerCase()) main().catch(() => { console.error("Shared Zone transfer failed; resumable state retained. Use the attachment skill recovery workflow."); process.exitCode = 1; });
