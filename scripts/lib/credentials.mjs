import { loadTransport } from "./transport.mjs";
const credentials = await loadTransport("lib/credentials.mjs");
export const { readAzureSecret } = credentials;
export function resolveNotionCredentials(options = {}, needToken = true) {
  return credentials.resolveNotionCredentials({ ...options, vaultName: options.vaultName || process.env.NOTION_KEY_VAULT || "kv-boccaro-shared-e9219", pageIdSecret: options.pageIdSecret || process.env.NOTION_PAGE_ID_SECRET || "notion-shared-zone-page-id", apiKeySecret: options.apiKeySecret || process.env.NOTION_API_KEY_SECRET || "notion-shared-zone-api-key" }, needToken);
}
