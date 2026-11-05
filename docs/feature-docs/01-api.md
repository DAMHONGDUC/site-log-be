# API

<dl><dd>

- Every endpoint and WebSocket message the backend serves. The iOS app codes against this page; the backend tests check it.
- How each one works inside: [03-sync-uploads-realtime](03-sync-uploads-realtime.md).

</dd></dl>

## Contents

<dl><dd>

1. [Conventions](#1-conventions)
2. [Error contract](#2-error-contract)
3. [Endpoints](#3-endpoints)
4. [Health](#4-health)
5. [Account](#5-account)
6. [Sync](#6-sync)
7. [Uploads](#7-uploads)
8. [Media URLs](#8-media-urls)
9. [Verify](#9-verify)
10. [Devices](#10-devices)
11. [WebSocket](#11-websocket)
12. [Shared constants](#12-shared-constants)

</dd></dl>

## 1. Conventions

<dl><dd>

| Item | Rule |
|---|---|
| Base URL | dev `http://localhost:3000` · staging `https://api-staging.<domain>` · prod `https://api.<domain>` |
| Auth | `Authorization: Bearer <Firebase ID token>` on every route except `/health` and `/verify` |
| Body | JSON, `Content-Type: application/json`, at most 1 MiB |
| Field names | `camelCase` in JSON (`clientUpdatedAt`); the server stores `snake_case` |
| Ids | UUIDs made by the app; any case is accepted, the server returns **lowercase** |
| Timestamps | ISO 8601 in UTC with milliseconds: `2026-11-05T09:00:00.000Z`; send the same format |
| Dates | Plain `YYYY-MM-DD` (issue due date) |
| Hashes | SHA-256 as 64 lowercase hex characters |
| Caching | Nothing may be cached: the app reads its clock offset from the `Date` header |

- Swift: `ISO8601DateFormatter` with `[.withInternetDateTime, .withFractionalSeconds]` reads and writes this timestamp format.

</dd></dl>

## 2. Error contract

<dl><dd>

- Every error has one shape, never a stack trace:

```json
{ "error": { "code": "invalid_key", "message": "Key has the wrong shape or another owner" } }
```

| Status | The app reads it as | Sent for |
|---|---|---|
| `200` | Success | Including a repeated `complete` or `DELETE` |
| `400` | Permanent: **abort the job** | Malformed body, bad key, wrong size, missing parts |
| `401` | Refresh the token once, retry | Missing, expired, revoked or malformed token — never `403` |
| `404` | Permanent | Unknown or aborted upload, nothing uploaded, unknown code, unknown route |
| `409` | Success on `complete` (body carries the stored result) | Same key completed by another upload; abort of a completed upload |
| `413` | Permanent | Body over 1 MiB, file over the upload limit |
| `429` | Transient, wait | Rate limit |
| `5xx` | Transient, retry with backoff | Server fault, `503 auth_unavailable` when Firebase cannot be reached |

- `403` only ever comes from S3 on a presigned URL: it means the URL expired.

</dd></dl>

## 3. Endpoints

<dl><dd>

| # | Method | Path | Auth | Purpose | Since |
|---|---|---|---|---|---|
| 1 | `GET` | `/health` | none | Liveness | F00 |
| 2 | `DELETE` | `/account` | Bearer | Delete every file, row and the Firebase user | F02 |
| 3 | `POST` | `/sync/pull` | Bearer | Changes since a cursor | F04 |
| 4 | `POST` | `/sync/push` | Bearer | Apply a batch of mutations | F04 |
| 5 | `POST` | `/uploads` | Bearer | Begin: single PUT or multipart plan | F06 · F07 |
| 6 | `POST` | `/uploads/:id/complete` | Bearer | Confirm, record, issue a code — idempotent | F06 |
| 7 | `DELETE` | `/uploads/:id` | Bearer | Abort — idempotent | F06 |
| 8 | `POST` | `/media/urls` | Bearer | GET URLs for stored files | F06 |
| 9 | `POST` | `/uploads/:id/parts/refresh` | Bearer | New URLs for expired parts | F07 |
| 10 | `GET` | `/verify/:code` | none | Facts about a code printed in a report | F10 |
| 11 | `WS` | `/ws` | first message | Upload state for open sessions | F15 |
| 12 | `POST` | `/devices` | Bearer | Register an APNs token | F16 |
| 13 | `DELETE` | `/devices/:token` | Bearer | Remove it on sign-out | F16 |

</dd></dl>

## 4. Health

<dl><dd>

- `GET /health` → `200 {"status":"ok"}`, or `503 {"status":"database_unreachable"}`. Header `cache-control: no-store`.

</dd></dl>

## 5. Account

<dl><dd>

- `DELETE /account` → files first, then rows, then the Firebase user. Safe to repeat; a repeat returns zeros.

```json
{ "deletedObjects": 214, "abortedUploads": 1, "deletedRows": 932 }
```

- The app reauthenticates first (Apple requires recent sign-in), shows the numbers, then wipes local data.

</dd></dl>

## 6. Sync

<dl><dd>

### 6.1 Pull

<dl><dd>

```json
POST /sync/pull
{ "since": 0, "limit": 500 }
```

| Field | Rule |
|---|---|
| `since` | The `nextRev` of the last pull; `0` for a full download |
| `limit` | 1 … 500 rows |

```json
{
  "changes": {
    "projects": [
      { "id": "1111…", "rev": 41, "clientUpdatedAt": "2026-11-01T08:00:00.000Z", "deletedAt": null,
        "name": "Tower A", "address": null, "clientName": null, "createdAt": "2026-11-01T08:00:00.000Z" }
    ],
    "locations": []
  },
  "nextRev": 41,
  "hasMore": false
}
```

- Only tables with changes appear in `changes`. Rows with `deletedAt` set are tombstones: delete them locally.
- `hasMore: true` → pull again at once with `since = nextRev`.
- `{ "resyncRequired": true }` → the cursor is older than the 90-day tombstone purge: wipe synced data and pull from `0`.

</dd></dl>

### 6.2 Push

<dl><dd>

```json
POST /sync/push
{
  "mutations": [
    { "table": "projects", "id": "1111…", "op": "upsert", "clientUpdatedAt": "2026-11-01T08:00:00.000Z",
      "fields": { "name": "Tower A", "address": null, "clientName": null, "createdAt": "2026-11-01T08:00:00.000Z" } },
    { "table": "locations", "id": "2222…", "op": "delete", "clientUpdatedAt": "2026-11-01T09:00:00.000Z", "fields": {} }
  ]
}
```

| Field | Rule |
|---|---|
| `mutations` | 1 … 200, in dependency order (parents first); applied in one transaction |
| `op` | `upsert` sends the **full row** in `fields` (every column of the table below, `null` where empty); `delete` sends `{}` |
| `clientUpdatedAt` | When the change was made on the device: the last write wins |

```json
{
  "results": [
    { "id": "1111…", "status": "applied" },
    { "id": "2222…", "status": "superseded", "serverRow": { "id": "2222…", "code": "L1", "…": "…" } },
    { "id": "3333…", "status": "rejected", "reason": "missing_parent" }
  ],
  "serverRev": 44
}
```

| Status | Meaning | The app |
|---|---|---|
| `applied` | Stored | Mark the mutation done |
| `superseded` | The server holds a newer row, a tombstone, or a row with the same natural key | Replace the local row with `serverRow` (its `id` may differ) |
| `rejected` | The row can never be stored as sent | Drop the mutation, log `reason` |

| `reason` | Cause |
|---|---|
| `unknown_table` | `table` is not in the list below |
| `unknown_field:<name>` | A field the table does not have |
| `invalid_row:<code>` | A value or rule broke: `23502` missing value, `23514` rule (e.g. half a pin), `23505` duplicate, `22…` wrong type |
| `missing_parent` | A referenced row is not on the server and not in the batch |
| `forbidden` | The id belongs to another account |

- Rules the server applies, whatever the timestamps say:
  - `sessions.state` only moves forward: `draft < active < closed < exported`.
  - Columns marked *frozen* below keep their first value.
  - A deleted row never comes back.

</dd></dl>

### 6.3 Synced tables

<dl><dd>

| Table | Fields in `fields` (full row) | Frozen | Natural key | Since |
|---|---|---|---|---|
| `projects` | `name`, `address`, `clientName`, `createdAt` | `createdAt` | — | F03 |
| `locations` | `projectId`, `parentId`, `code`, `kind` (`floor` · `unit` · `room`), `sortIndex` | `projectId` | — | F03 |
| `sessions` | `projectId`, `startedAt`, `endedAt`, `surveyorName`, `note`, `state` | `projectId`, `startedAt` | — | F03 |
| `captures` | `projectId`, `sessionId`, `locationId`, `kind` (`photo` · `video` · `audio`), `sha256`, `byteSize`, `capturedAt`, `timeConfidence`, `latitude`, `longitude`, `horizontalAccuracy`, `deviceModel`, `durationSeconds`, `deviceReading`, `remoteKey`, `verificationCode`, `excludedFromReport` | all but `locationId`, `remoteKey`, `verificationCode`, `excludedFromReport` | — | F05 |
| `issues` | `projectId`, `locationId`, `title`, `detail`, `severity` (`critical` · `major` · `minor`), `status` (`open` · `inProgress` · `resolved` · `verified`), `dueDate`, `assigneeName`, `trade`, `planSheetId`, `pinX`, `pinY`, `resolvedByIssueId`, `sourceChecklistResultId` | — | — | F08 |
| `issue_captures` | `issueId`, `captureId` | both | `issueId` + `captureId` | F08 |
| `phrases` | `text`, `usageCount` | `text` | `text` | F08 |
| `annotations` | `shapes` (JSON array); `id` = the capture id | — | — | F09 |
| `report_branding` | `companyName`, `logoKey`, `accentHex` (`#RRGGBB`), `clientBlock`, `footerText` | — | one per user | F10 |
| `plan_sheets` | `projectId`, `locationId`, `name`, `pageIndex`, `pixelWidth`, `pixelHeight`, `sha256`, `remoteKey` | `projectId`, `sha256`, `pixelWidth`, `pixelHeight` | — | F11 |
| `checklist_templates` | `projectId`, `name`, `appliesTo`, `isBuiltIn`, `usageCount` | — | — | F12 |
| `checklist_template_items` | `templateId`, `ordinal`, `text`, `defaultSeverity`, `requiresPhotoOnFail` | — | — | F12 |
| `checklist_runs` | `templateId`, `sessionId`, `locationId`, `startedAt`, `completedAt` | all but `completedAt` | — | F12 |
| `checklist_results` | `runId`, `templateItemId`, `outcome` (`pass` · `fail` · `na` · `null`), `note`, `issueId`, `answeredAt` | `runId`, `templateItemId` | `runId` + `templateItemId` | F12 |

- Every pulled row also carries `id`, `rev`, `clientUpdatedAt`, `deletedAt`.
- A pin is `planSheetId` + `pinX` + `pinY` (each 0…1) together, or all three `null`.
- `latitude` and `longitude` are both set or both `null`.

</dd></dl>

</dd></dl>

## 7. Uploads

<dl><dd>

### 7.1 Keys

<dl><dd>

| File | Key |
|---|---|
| Capture | `{uid}/{projectId}/{sessionId}/{captureId}.{jpg·heic·png·mov·mp4·m4a}` |
| Plan sheet | `{uid}/{projectId}/plans/{sheetId}.{pdf·jpg·png·heic}` |
| Branding logo | `{uid}/branding/{logoId}.{png·jpg}` |

- `uid` is the Firebase uid of the caller. Any other shape, another uid, `..` or a leading `/` → `400 invalid_key`.

</dd></dl>

### 7.2 Begin

<dl><dd>

```json
POST /uploads
{ "key": "uid/…/….jpg", "byteSize": 2400000, "contentType": "image/jpeg", "sha256": "9f86d0…" }
```

- Under 5 MiB → one PUT:

```json
{ "mode": "single", "uploadId": "…", "url": "https://sitelog-…s3…amazonaws.com/…?X-Amz-Signature=…", "expiresAt": "…" }
```

- From 5 MiB (F07) → 8 MiB parts, every part URL at once:

```json
{ "mode": "multipart", "uploadId": "…", "partSizeBytes": 8388608,
  "parts": [ { "number": 1, "url": "…" }, { "number": 2, "url": "…" } ], "expiresAt": "…" }
```

| Rule | Detail |
|---|---|
| PUT | `PUT <url>` with the bytes and header `Content-Type` equal to `contentType` — the signature covers it |
| Part ETag | Each part's `200` carries an `ETag` header: keep it for `complete` |
| Size limit | 20 GiB (`413 file_too_large`) |
| Rate limit | 600 begins per minute per user (`429`) |
| URL lifetime | 1 hour; `403` from S3 = expired, refresh (multipart) or begin again (single) |

</dd></dl>

### 7.3 Refresh part URLs (F07)

<dl><dd>

```json
POST /uploads/:id/parts/refresh
{ "numbers": [13, 14, 15] }
→ { "parts": [ { "number": 13, "url": "…" } ], "expiresAt": "…" }
```

- `404` once the upload is completed or aborted; `400` for a number past the last part.

</dd></dl>

### 7.4 Complete

<dl><dd>

```json
POST /uploads/:id/complete
{}                                                     // single
{ "parts": [ { "number": 1, "etag": "\"a54…\"" } ] }   // multipart: every part, once
→ { "uploadId": "…", "remoteKey": "uid/…/….jpg", "sha256": "9f86d0…", "verificationCode": "K7M2QX9HTP",
    "verified": false, "receivedAt": "2026-11-05T09:00:00.000Z" }
```

- **Idempotent:** a retry after a lost response returns the same body.
- `404 object_not_found` → nothing was uploaded; `400 size_mismatch` → the stored size differs from `byteSize`.
- `409 already_completed` → another upload of the same key won; the error body also carries `remoteKey` and `verificationCode`: treat as success.
- `verified` turns `true` later, when the worker has re-read the file (WebSocket `jobCompleted`, F15).

</dd></dl>

### 7.5 Abort

<dl><dd>

- `DELETE /uploads/:id` → `{ "uploadId": "…", "aborted": true }`; repeatable; `409` for a completed upload.

</dd></dl>

</dd></dl>

## 8. Media URLs

<dl><dd>

```json
POST /media/urls
{ "keys": ["uid/…/….jpg"] }
→ { "urls": [ { "key": "uid/…/….jpg", "url": "https://…" } ], "expiresAt": "…" }
```

- At most 200 keys; each must be the caller's. Cache images by key, not by URL (the query string changes).

</dd></dl>

## 9. Verify

<dl><dd>

```json
GET /verify/K7M2QX9HTP
→ { "code": "K7M2QX9HTP", "sha256": "9f86d0…", "byteSize": 2400000, "receivedAt": "…",
    "verifyState": "verified", "verified": true, "verifiedAt": "…", "projectRef": "1A2B3C4D" }
```

- Public, no token. Case-insensitive code. Never returns the file, a URL, the uid or coordinates.
- `projectRef` = first 8 characters of the project id, upper case — print it in the report header.
- Unknown code → `404` after the same delay as a hit. 30 lookups per minute per IP (`429`).

| `verifyState` | Report wording |
|---|---|
| `registered` | "registered {code}" |
| `verified` | "verified {code}" |
| `mismatch` | Never printed; the app shows an integrity flag |

</dd></dl>

## 10. Devices

<dl><dd>

```json
POST /devices
{ "token": "<APNs device token, hex>", "environment": "sandbox" }
→ { "registered": true }
```

- `environment`: `sandbox` for Debug builds, `production` for TestFlight and App Store.
- `DELETE /devices/:token` → `{ "removed": true }` on sign-out.
- A push carries `aps.alert`, `deepLink` (`sitelog://session/<id>`) and `account` (first 16 hex of SHA-256 of the uid): ignore a push whose `account` is not the signed-in user.

</dd></dl>

## 11. WebSocket

<dl><dd>

- `wss://<host>/ws`. One JSON object per text frame, at most 64 KiB.

| Direction | Message |
|---|---|
| App → server | `{"type":"auth","token":"<ID token>"}` — first, within 5 s |
| App → server | `{"type":"subscribe","sessionID":"<uuid>"}` |
| App → server | `{"type":"ping","at":<number>}` |
| Server → app | `{"type":"snapshot","sessionID":"…","completed":[{"jobID","remoteKey","sha256","verified"}],"failed":[{"jobID","reason"}]}` — always first after `subscribe` |
| Server → app | `{"type":"jobCompleted","jobID":"…","remoteKey":"…","sha256":"…","verified":false}` — after `complete`, and again with `verified: true` |
| Server → app | `{"type":"jobFailed","jobID":"…","reason":"integrity"}` or `"aborted"` |
| Server → app | `{"type":"pong","at":<same number>}` |

- `jobID` is the `uploadId` from begin.
- Trust `jobCompleted` only if its `sha256` equals the local hash.

| Close code | Meaning | The app |
|---|---|---|
| `4000` | No `auth` within 5 s | Reconnect, send `auth` first |
| `4001` | Token invalid or expired | Refresh the token, reconnect |
| `4003` | Subscribed to another account's session | Bug: log, do not retry that session |
| `4008` | More than 5 sockets for this account | Close older sockets |
| `1009` | Message over 64 KiB | Bug |

</dd></dl>

## 12. Shared constants

<dl><dd>

- These must match on both sides; the backend reads them from its environment ([04-aws-operations](04-aws-operations.md#3-configuration)).

| Constant | Value | iOS |
|---|---|---|
| Single-PUT threshold | 5 MiB (5,242,880 bytes) | `UploadConstants.singlePutThresholdBytes` |
| Part size | 8 MiB (8,388,608 bytes) | `UploadConstants.partSizeBytes` |
| Presigned URL lifetime | 1 hour | proactive refresh before `expiresAt` |
| Pull page size | ≤ 500 | `SyncConstants.pullPageSize` |
| Push batch size | ≤ 200 | `SyncConstants.pushBatchSize` |
| Tombstone retention | 90 days | `SyncConstants.tombstoneRetentionDays` |
| WebSocket auth timeout | 5 s | `RealtimeConstants.authTimeout` |
| WebSocket max message | 64 KiB | `RealtimeConstants.maxMessageBytes` |

</dd></dl>
