import { spawnSync } from "node:child_process";
import { DEFAULTS, normalizeNotionId } from "./core.mjs";

export function readAzureSecret(vault, name) {
  if (!/^[A-Za-z0-9-]{1,127}$/u.test(vault) || !/^[A-Za-z0-9-]{1,127}$/u.test(name)) {
    throw new Error("Unsafe Azure Key Vault identifier.");
  }
  const common = ["keyvault", "secret", "show", "--vault-name", vault, "--name", name, "--query", "value", "--output", "tsv", "--only-show-errors"];
  const executable = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "az";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", `az ${common.join(" ")}`] : common;
  const result = spawnSync(executable, args, { encoding: "utf8", windowsHide: true, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Azure Key Vault lookup failed for ${name}: ${(result.stderr || "unknown error").trim()}`);
  const value = result.stdout.trim();
  if (!value) throw new Error(`Azure Key Vault secret is empty: ${name}`);
  return value;
}

export function resolveNotionCredentials(options = {}, needToken = true) {
  const vaultName = options.vaultName || process.env.NOTION_KEY_VAULT || DEFAULTS.vaultName;
  const pageIdSecret = options.pageIdSecret || process.env.NOTION_PAGE_ID_SECRET || DEFAULTS.pageIdSecret;
  const apiKeySecret = options.apiKeySecret || process.env.NOTION_API_KEY_SECRET || DEFAULTS.apiKeySecret;
  const pageId = normalizeNotionId(options.pageId || process.env.NOTION_PAGE_ID || readAzureSecret(vaultName, pageIdSecret));
  const token = needToken ? (process.env.NOTION_API_KEY || readAzureSecret(vaultName, apiKeySecret)) : "";
  if (needToken && !/^(?:ntn_|secret_)[A-Za-z0-9_-]{20,}$/u.test(token)) throw new Error("Resolved Notion API key has an unexpected format.");
  return { pageId, token, vaultName, pageIdSecret, apiKeySecret };
}
