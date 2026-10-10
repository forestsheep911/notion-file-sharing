# Shared Zone operations

This reference owns Shared Zone configuration and business workflow. Attachment transport is implemented only by the installed `notion-attachment-transfer` skill; read its SKILL.md and operations before transfer.

## Configuration

- Shared Zone: https://app.notion.com/p/boccaro/Shared-Zone-3e720ac12f0a80688b00c6bcdb38a774
- Shared vault: `kv-boccaro-shared-e9219` (`rg-shared-services`).
- Page reference: `notion-shared-zone-page-id`.
- API-key reference: `notion-shared-zone-api-key`.

Resolve secrets at runtime. These are Shared Zone defaults, not defaults for WWP, WWV or arbitrary Notion attachments. Sharing permissions remain unchanged unless explicitly requested.

## Schema

Read `shared-zone-schema.md`, then use:

```powershell
node scripts/shared-zone-schema.mjs
node scripts/shared-zone-schema.mjs --apply
node scripts/shared-zone-schema.mjs --verify-only
```

The schema tool creates only missing exact-name databases, checks duplicates/drift, and preserves state in `.notion-file-sharing/shared-zone-schema.json`. It creates no records and changes no sharing permissions. It uses the shared local API coordinator; project metadata rules may be stricter.

## Compatible Shared Zone upload entry

```powershell
node scripts/notion-file-share.mjs --file "C:\path\report.pdf"
node scripts/notion-file-share.mjs --file "C:\path\report.pdf" --preflight
node scripts/notion-file-share.mjs --file "C:\path\report.pdf" --apply
node scripts/notion-file-share.mjs --file "C:\path\report.pdf" --verify-only
```

This forwarding wrapper supplies Shared Zone credential/destination references only when callers have not supplied their own. Existing commands, upload IDs, accepted parts and `.notion-file-sharing` state paths remain valid. General downloads use the attachment skill directly; select the Shared Zone source record/block here first.

Attachment verification is one gate. Also verify the selected record, file count/order, metadata and intended audience status. Do not publish or change page access as an implicit side effect.

## Independent attachment dependency

Install the separate `notion-attachment-transfer` repository, run `npm ci` there, and link/install it in the global skill directory. Shared Zone wrappers discover that installation via `$CODEX_HOME/skills/notion-attachment-transfer` (default `~/.codex/skills/notion-attachment-transfer`) or `NOTION_ATTACHMENT_TRANSFER_ROOT`. No sibling checkout layout is required. This repository has its own lockfile and checks; run `npm ci` and `npm run check` here after installing transport.
