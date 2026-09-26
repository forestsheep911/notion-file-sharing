# Shared Zone Database Contract

The Shared Zone root contains exactly two full-page child databases. The root itself and both databases remain private unless the user separately authorizes a sharing change.

## Top-level databases

- `共享文件｜私人库`: working and personal records. A record page is the unit of storage and may contain files in its page body.
- `共享文件｜公开库`: approved public-facing records only. Do not create drafts here and do not copy internal operational metadata into it.

The databases are a physical privacy boundary, not filtered views of one database. Creating these databases never authorizes publishing the root, either database, or any record.

## Private database properties

| Property | Type | Contract |
| --- | --- | --- |
| 名称 | title | Record name |
| 资源 ID | rich_text | Stable logical identity |
| 类型 | select | 文档, 图片, 音频, 视频, 压缩包, 其他 |
| 标签 | multi_select | Free controlled tags |
| 简介 | rich_text | Human summary |
| 目标受众 | select | 仅自己, 公开候选 |
| 工作流状态 | select | 草稿, 上传中, 待核验, 可用, 失败, 归档 |
| 公开批准 | checkbox | Explicit publication gate |
| 文件数 | number | Attachment count |
| 总字节 | number | Exact byte count |
| 清单哈希 | rich_text | Manifest digest |
| 版本 | rich_text | Human or machine version |
| 来源 URL | url | Optional source link |
| 来源说明 | rich_text | Optional provenance notes |
| 上传核验时间 | date | Live readback completion |
| 公开记录 | url | Link to separately promoted public record |
| 有效期 | date | Optional expiry |
| 内部备注 | rich_text | Private operational notes |
| 创建时间 | created_time | Notion-managed |
| 更新时间 | last_edited_time | Notion-managed |

## Public database properties

| Property | Type | Contract |
| --- | --- | --- |
| 名称 | title | Public record name |
| 资源 ID | rich_text | Stable logical identity |
| 类型 | select | 文档, 图片, 音频, 视频, 压缩包, 其他 |
| 标签 | multi_select | Public tags |
| 简介 | rich_text | Public summary |
| 版本 | rich_text | Published version |
| 语言 | multi_select | 中文, 英文, 日文, 其他 |
| 文件数 | number | Attachment count |
| 总字节 | number | Exact byte count |
| 发布时间 | date | Publication timestamp |
| 更新说明 | rich_text | Public change notes |
| 使用说明 | rich_text | Public usage guidance |
| 有效期 | date | Optional expiry |
| 创建时间 | created_time | Notion-managed |
| 更新时间 | last_edited_time | Notion-managed |

Never add local paths, resumable state paths, upload IDs, credentials, Vault details, private source material, failure logs, internal notes, or the private approval gate to the public database.

## Record body contract

When records are added later, their page body should contain a file area, content description, an ordered machine-readable manifest with filename, exact bytes, SHA-256, and order, plus an update history. File transport remains owned by this skill's uploader.
