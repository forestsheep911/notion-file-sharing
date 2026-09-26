# Operations

## Requirements

- Node.js 20 or newer.
- A Notion integration with access to the target page and permission to insert content.
- Azure CLI logged into the account containing the configured Key Vault, unless credentials are supplied through `NOTION_API_KEY` and `NOTION_PAGE_ID`.
- For enforced route checks, a Mihomo/Clash controller exposed through the Verge named pipe or `CLASH_CONTROLLER_URL`.

The defaults are intended for the user's Shared Zone:

- Vault: `kv-boccaro-shared-e9219`
- Page ID secret: `notion-shared-zone-page-id`
- API key secret: `notion-shared-zone-api-key`
- Controller pipe: `\\.\pipe\verge-mihomo`
- Selector chain: `DIRECT > 国内直连 > Notion`

Override identifiers, never secret values, with CLI options or environment variables. The script also accepts `NOTION_API_KEY` and `NOTION_PAGE_ID` for environments without Azure CLI.

## Modes

```powershell
# No network writes: inspect the plan and compute the file hash.
node scripts/notion-file-share.mjs --file "C:\path\report.pdf"

# Read-only live checks: Key Vault, page access, and route selector.
node scripts/notion-file-share.mjs --file "C:\path\report.pdf" --preflight

# Upload, attach, persist state, and read the block back.
node scripts/notion-file-share.mjs --file "C:\path\report.pdf" --apply

# Recheck a completed attachment without uploading again.
node scripts/notion-file-share.mjs --file "C:\path\report.pdf" --verify-only
```

Use `--state <path>` to choose a durable state location. The default is `.notion-file-sharing/<filename>-<sha-prefix>.json` under the current directory. State contains identifiers, hashes, part progress, and block evidence but never the API key.

Useful overrides:

```text
--page-id <id-or-url>
--vault-name <name>
--page-id-secret <name>
--api-key-secret <name>
--block-type <auto|file|image|pdf|video|audio>
--caption <text>
--part-mib <5..20>
--route-check <connections|selector|off>
--expected-chain "DIRECT>国内直连>Notion"
--resolve-ip <fresh-api-ip> --local-address <fresh-lan-ip>
```

`--route-check off` removes a safety gate. Use it only when the user explicitly accepts missing route evidence for that transfer. It is not a workaround for a failed or proxy route.

## API and size behavior

The default Notion API version is `2026-03-11`. Files up to 20 MiB use `single_part`; larger files use `multi_part` with serial 20 MiB parts. Notion requires non-final multipart parts to be between 5 and 20 MiB. The current official limit for API bots in paid workspaces is 5 GB per file. Recheck official Notion documentation before relying on these limits in a long-lived workflow.

The uploader uses the file's SHA-256, size, page ID, and persisted upload ID as its resume identity. It reconciles the server's accepted sequential part count before continuing. A completed upload is attached within the upload object's one-hour lifetime, then the returned block ID is retrieved and checked.

## Recovery

- On `429`, the shared limiter honors `Retry-After` with jitter and launches no concurrent request.
- On a transient timeout, reset, or eligible server error, rerun the same command and state file. Accepted parts are reconciled and reused.
- An expired incomplete File Upload starts a new session but retains the prior session record in state history.
- A route rejection stops before the next part and preserves accepted progress.
- If attachment outcome is uncertain and no verified block ID exists, the script scans the target page for the deterministic caption and stops for review rather than risking a duplicate.
- Never delete the source or state as part of retry handling.

## Project integration

Call this skill as the transport layer. WWP remains responsible for spec pages, Media Assets, ledger and website release. WWV remains responsible for intake grouping, preview generation, format tags and Cavalry.db conventions. A calling project may supply an exact destination page and caption, then consume the verified block ID from the state.
