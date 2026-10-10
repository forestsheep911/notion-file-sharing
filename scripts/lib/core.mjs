import { loadTransport } from "./transport.mjs";
const core = await loadTransport("lib/core.mjs");
export const { buildPartPlan, captionText, defaultStatePath, evaluateRoutes, inferBlockType, inferMime, isOwnedUploadConnection, isTransient, normalizeNotionId, notionApiAddressCandidates, isNotionConnectionTarget, readJson, usesPhysicalDirectEvidence, sha256File, writeJsonAtomic } = core;
export const DEFAULTS = Object.freeze({ ...core.DEFAULTS, vaultName: "kv-boccaro-shared-e9219", pageIdSecret: "notion-shared-zone-page-id", apiKeySecret: "notion-shared-zone-api-key" });
