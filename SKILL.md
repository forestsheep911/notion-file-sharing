---
name: notion-file-sharing
description: Organize and deliver general shared files through the user's Notion Shared Zone, including its private/public database structure and file records. Use for Shared Zone workflows; attachment transport belongs to notion-attachment-transfer.
---

# Notion File Sharing

Own the Shared Zone file-sharing workflow. Select the correct database/record, prepare names and metadata, and verify delivery structure. Never infer or change sharing permissions or public approval.

Read [shared-zone-schema.md](references/shared-zone-schema.md) for database creation/verification, and [operations.md](references/operations.md) for Shared Zone configuration and commands.

For any attachment upload or download, read the installed `notion-attachment-transfer/SKILL.md` and call its scripts. This skill's old upload command only forwards to that implementation with Shared Zone credential/destination defaults. WWP and WWV should call the attachment skill directly with their own target and credentials.

1. Identify the intended shared file and exact destination record. Creating a record does not authorize public sharing.
2. Inspect/verify the Shared Zone schema only when the task requires it; do not rescan all records for a single transfer.
3. Plan the delivery, then call attachment transport with durable resumable state.
4. Read back the resulting block and verify the Shared Zone record, file count/order and requested metadata.
5. Report the exact destination and evidence. Retain sources and state; cleanup is separate.
