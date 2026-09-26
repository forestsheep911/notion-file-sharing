---
name: notion-file-sharing
description: Initialize and verify the user's Notion Shared Zone databases, or upload local files to a Notion page with Azure Key Vault credential lookup, DIRECT-route enforcement, resumable multipart state, idempotency guards, and live block readback. Use for shared-file delivery through Notion; do not use for project-specific media catalogs or website publication.
---

# Notion File Sharing

Use the bundled scripts for the Shared Zone structure and file transport. Keep project-specific naming, metadata, and publication gates in the calling project.

For Shared Zone database creation or verification, read [references/shared-zone-schema.md](references/shared-zone-schema.md) first. Run `node scripts/shared-zone-schema.mjs` for a read-only plan, `--apply` to create missing databases, and `--verify-only` for an exact schema readback. The initializer never creates records or changes sharing permissions.

## Workflow

1. Identify the exact local file and target page. Never infer sharing permissions or change page access.
2. Run a dry run, then `--preflight`. The preflight proves file identity, page access, and the configured Mihomo/Clash selector without creating an upload.
3. Before `--apply`, confirm the requested upload is authorized. Process one file at a time and keep the generated state file.
4. Apply with DIRECT route enforcement. The uploader is serial, rate-limited, resumable, and verifies the actual route while sending large parts.
5. Run `--verify-only` and report the exact page, block, filename, hash, and state path. Do not call a multipart upload complete merely because all parts were accepted.
6. Preserve the source and state until the destination block has passed live readback. Cleanup is a separate explicit operation.

Default credential lookup uses Azure Key Vault `kv-boccaro-shared-e9219`, secrets `notion-shared-zone-page-id` and `notion-shared-zone-api-key`. Environment variables or CLI names can override those identifiers without storing secret values in the repository or state.

For commands, recovery behavior, route configuration, supported block types, and current API constraints, read [references/operations.md](references/operations.md). Run a script's `--help` before using unfamiliar options.

## Guardrails

- Never print, persist, or commit the Notion API key. Do not load credentials from a repository `.env` by default.
- Default to one shared request limiter, one upload worker, and one file per invocation.
- A non-DIRECT, `Match`, mixed, missing, or uncertain route stops a large transfer. `--no-proxy` alone does not bypass a TUN.
- Use `--resolve-ip` only together with `--local-address`; both values must be freshly discovered for that run. The bound connection must still produce DIRECT evidence.
- Resume an unexpired session from its state and accepted-part boundary. Do not recreate the page, restart from part 1, or retransmit accepted parts after a transient failure.
- If a possible matching block exists without verified local state, stop for review instead of appending a duplicate.
- Do not split a source into multiple visible files merely to work around Notion's 5 GB file limit unless the user requests a logical split. This skill chunks one file only at the API transport layer.
- Never change Notion sharing permissions. Upload authorization does not authorize making a page public or inviting people.
