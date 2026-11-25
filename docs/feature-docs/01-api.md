# API

<dl><dd>

- Every endpoint and WebSocket message the backend serves. The iOS and Android apps code against this page; the backend tests check it.
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
13. [Team](#13-team)

</dd></dl>

## 1. Conventions

<dl><dd>

| Item | Rule |
|---|---|
| Base URL | dev `http://localhost:3000` · staging `https://api-staging.<domain>` · prod `https://api.<domain>` |
| Auth | `Authorization: Bearer <Firebase ID token>` on every route except `/health` and `/verify`; the caller must be a member ([05-team-and-roles](05-team-and-roles.md)) |
| Body | JSON, `Content-Type: application/json`, at most 1 MiB |
| Field names | `camelCase` in JSON (`clientUpdatedAt`); the server stores `snake_case` |
| Ids | UUIDs made by the app; any case is accepted, the server returns **lowercase** |
| Timestamps | ISO 8601 in UTC with milliseconds: `2026-11-05T09:00:00.000Z`; send the same format |
| Dates | Plain `YYYY-MM-DD` (issue due date) |
| Hashes | SHA-256 as 64 lowercase hex characters |
| Caching | Nothing may be cached: the app reads its clock offset from the `Date` header |

- Swift: `ISO8601DateFormatter` with `[.withInternetDateTime, .withFractionalSeconds]` reads and writes this timestamp format.
- Kotlin: an `Instant` serializer with `DateTimeFormatter.ISO_INSTANT`, truncated to milliseconds.

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
| `403` | Permanent: show "not allowed", do not retry | `forbidden` (the role may not do this, or the project is not reachable), `not_invited` (signed in but not a member) |
| `404` | Permanent | Unknown or aborted upload, nothing uploaded, unknown code, unknown route |
| `409` | Success on `complete` (body carries the stored result) | Same key completed by another upload; abort of a completed upload; `last_admin` on a team change |
| `413` | Permanent | Body over 1 MiB, file over the upload limit |
| `429` | Transient, wait | Rate limit |
| `5xx` | Transient, retry with backoff | Server fault, `503 auth_unavailable` when Firebase cannot be reached |

- A `403` from S3 on a presigned URL (XML body) means the URL expired; a `403` from the API (JSON `error` body) means the role or project access says no.

</dd></dl>

## 3. Endpoints

<dl><dd>

| # | Method | Path | Auth | Purpose | Since |
|---|---|---|---|---|---|
| 1 | `GET` | `/health` | none | Liveness | F00 |
| 2 | `DELETE` | `/account` | Bearer | Leave the company: delete the Firebase user, devices and phrases; company records stay | F02 · F19 |
| 3 | `POST` | `/sync/pull` | Bearer | Changes since a cursor | F04 |
| 4 | `POST` | `/sync/push` | Bearer | Apply a batch of mutations | F04 |
| 5 | `POST` | `/uploads` | Bearer | Begin: single PUT or multipart plan | F06 · F07 |
| 6 | `POST` | `/uploads/:id/complete` | Bearer | Confirm, record, issue a code — idempotent | F06 |
| 7 | `DELETE` | `/uploads/:id` | Bearer | Abort — idempotent | F06 |
| 8 | `POST` | `/media/urls` | Bearer | GET URLs for stored files | F06 |
| 9 | `POST` | `/uploads/:id/parts/refresh` | Bearer | New URLs for expired parts | F07 |
| 10 | `GET` | `/verify/:code` | none | Facts about a code printed in a report | F10 |
| 11 | `WS` | `/ws` | first message | Upload state for open sessions | F15 |
| 12 | `POST` | `/devices` | Bearer | Register an FCM token | F16 |
| 13 | `DELETE` | `/devices/:token` | Bearer | Remove it on sign-out | F16 |
| 14 | `GET` | `/me` | Bearer | The caller's member record: role, reachable projects | F19 |
| 15 | `GET` | `/members` | Bearer · Admin, Manager | Every member with role and projects | F19 |
| 16 | `POST` | `/invitations` | Bearer · Admin | Invite an email with a role and projects | F19 |
| 17 | `POST` | `/invitations/accept` | Bearer | Join with an invite token | F19 |
| 18 | `GET` | `/invitations/preview/:token` | none | Preview an invite before sign-in: who invited, role, projects | F19 |
| 19 | `POST` | `/invitations/:id/resend` | Bearer · Admin | New token and email; the old link stops working | F19 |
| 20 | `DELETE` | `/invitations/:id` | Bearer · Admin | Cancel an invite | F19 |
| 21 | `PATCH` · `DELETE` | `/members/:uid` | Bearer · Admin | Change a role and / or projects · remove a member | F19 |
| 22 | `PUT` | `/projects/:id/members` | Bearer · Admin, Manager | Set who works on a project | F19 |
| 23 | `GET` | `/member-events` | Bearer · Admin | Team activity log, newest first, paged | F19 |

</dd></dl>

## 4. Health

<dl><dd>

- `GET /health` → `200 {"status":"ok"}`, or `503 {"status":"database_unreachable"}`. Header `cache-control: no-store`.

</dd></dl>

## 5. Account

<dl><dd>

- `DELETE /account` → aborts the caller's unfinished uploads, deletes their phrases, devices and the Firebase user, and marks the member removed. Photos, issues and reports they made belong to the company and stay, shown as made by a former member ([05 §8](05-team-and-roles.md#8-removing-a-member-deleting-an-account)). Safe to repeat; a repeat returns zeros. The last Admin gets `409 last_admin`.

```json
{ "abortedUploads": 1, "deletedRows": 18 }
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
| `forbidden:<action>` | The project is not reachable, or the role may not do this ([05 §3](05-team-and-roles.md#3-permissions)) |

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
| `issues` | `projectId`, `locationId`, `title`, `detail`, `severity` (`critical` · `major` · `minor`), `status` (`open` · `inProgress` · `resolved` · `verified`), `dueDate`, `assigneeName`, `assigneeUid` (F19: a member; `null` when the assignee is only a typed name), `trade`, `planSheetId`, `pinX`, `pinY`, `resolvedByIssueId`, `sourceChecklistResultId` | — | — | F08 |
| `issue_captures` | `issueId`, `captureId` | both | `issueId` + `captureId` | F08 |
| `phrases` | `text`, `usageCount` | `text` | `text` | F08 |
| `annotations` | `shapes` (JSON array); `id` = the capture id | — | — | F09 |
| `report_branding` | `companyName`, `logoKey`, `accentHex` (`#RRGGBB`), `clientBlock`, `footerText` | — | one per company | F10 |
| `plan_sheets` | `projectId`, `locationId`, `name`, `pageIndex`, `pixelWidth`, `pixelHeight`, `sha256`, `remoteKey` | `projectId`, `sha256`, `pixelWidth`, `pixelHeight` | — | F11 |
| `checklist_templates` | `projectId`, `name`, `appliesTo`, `isBuiltIn`, `usageCount` | — | — | F12 |
| `checklist_template_items` | `templateId`, `ordinal`, `text`, `defaultSeverity`, `requiresPhotoOnFail` | — | — | F12 |
| `checklist_runs` | `templateId`, `sessionId`, `locationId`, `startedAt`, `completedAt` | all but `completedAt` | — | F12 |
| `checklist_results` | `runId`, `templateItemId`, `outcome` (`pass` · `fail` · `na` · `null`), `note`, `issueId`, `answeredAt` | `runId`, `templateItemId` | `runId` + `templateItemId` | F12 |

- Every pulled row also carries `id`, `rev`, `clientUpdatedAt`, `deletedAt` and `createdBy` (the member who made it, set by the server).
- Pull returns only rows of reachable projects; `phrases` are personal and sync only to their owner ([05 §6](05-team-and-roles.md#6-sync-with-shared-projects)).
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
| Capture | `projects/{projectId}/{sessionId}/{captureId}.{jpg·heic·png·mov·mp4·m4a}` |
| Plan sheet | `projects/{projectId}/plans/{sheetId}.{pdf·jpg·png·heic}` |
| Branding logo | `company/branding/{logoId}.{png·jpg}` |

- Any other shape, `..` or a leading `/` → `400 invalid_key`; a project the caller may not write ([05 §3](05-team-and-roles.md#3-permissions)) → `403 forbidden`.

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

- At most 200 keys; each must be in a project the caller reaches. Cache images by key, not by URL (the query string changes).

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
{ "token": "<FCM registration token>", "platform": "ios", "kinds": ["uploadsVerified", "issueAssigned", "issueRechecked", "access"] }
→ { "registered": true }
```

| Field | Rule |
|---|---|
| `token` | FCM registration token from the Firebase Messaging SDK (iOS too, never the raw APNs token); `[A-Za-z0-9_:-]`, 20–4096 chars |
| `platform` | `ios` or `android`; picks the message shape |
| `kinds` | F19, optional; the push kinds this device wants (table below); missing = all. The app posts again whenever the member changes a switch in You → Notifications, so choices live per device |

- `DELETE /devices/:token` → `{ "removed": true }` on sign-out.
- Register after sign-in and on every token refresh; a token FCM rejects is deleted by the server.

| Platform | Push the app receives |
|---|---|
| `ios` | System alert (`notification` title, body) + data `kind`, `deepLink`, `account` |
| `android` | Data only: `kind`, `deepLink`, `account`, `title`, `body`; the app builds the notification on the channel of that kind |

| Kind | When | Who gets it (never the member who caused it) | Example (title · body) | `deepLink` | Since |
|---|---|---|---|---|---|
| `uploadsVerified` | The last upload of a session is verified | F16: the member who started the session; F19: every member who reaches the project | Level 7 walkthrough is safe · All 112 photos are uploaded and verified. | `sitelog://session/<id>` | F16 |
| `issueAssigned` | `assignee_uid` is set or changed to a member | The new assignee | Assigned to you · Major · Hairline crack by the skirting, 7A Living room. Due Fri. | `sitelog://issue/<id>` | F19 |
| `issueRechecked` | A re-check is recorded: resolved, still open or worse | The issue's creator and assignee | Re-check: still open · Le Thu re-checked Exposed wiring at socket, 7A Kitchen. | `sitelog://issue/<id>` | F19 |
| `dueSoon` | Every day at 8:00 site time, open issues due the next day | Each assignee, one summary per project | 2 issues due tomorrow · Riverside Tower B · Phuc Electric, Tuan's crew. | `sitelog://project/<id>` (the app opens its Issues, due tomorrow) | F19 |
| `access` | Added to or removed from a project, or the role changes | That member | Added to Harbor View Villas · Hanh Nguyen added you as Inspector. | `sitelog://project/<id>`; none on removal | F19 |

- Text never carries a photo or a file name; titles stay under 40 characters, bodies under two lines.
- F16 ships the first kind only, without `kind` or `kinds`: title "Uploads verified", body "Every file in the session is stored and checked." F19 adds `kind` to every push, honours `kinds` and switches to the titles above.

- `account` = first 16 hex of SHA-256 of the uid: ignore a push whose `account` is not the signed-in user.

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
| `4001` | Token missing, invalid or expired, or a message sent before `auth` | Refresh the token, reconnect |
| `4003` | Not a member, or subscribed to another account's session | Not a member: ask an Admin to invite you. Other session: bug, do not retry it |
| `4008` | More than 5 sockets for this account | Close older sockets |
| `1009` | Message over 64 KiB | Bug |

</dd></dl>

## 12. Shared constants

<dl><dd>

- These must match on both sides; the backend reads them from its environment ([04-aws-operations](04-aws-operations.md#3-configuration)).

| Constant | Value | iOS | Android |
|---|---|---|---|
| Single-PUT threshold | 5 MiB (5,242,880 bytes) | `UploadConstants.singlePutThresholdBytes` | `UploadConstants.SINGLE_PUT_THRESHOLD_BYTES` |
| Part size | 8 MiB (8,388,608 bytes) | `UploadConstants.partSizeBytes` | `UploadConstants.PART_SIZE_BYTES` |
| Presigned URL lifetime | 1 hour | proactive refresh before `expiresAt` | proactive refresh before `expiresAt` |
| Pull page size | ≤ 500 | `SyncConstants.pullPageSize` | `SyncConstants.PULL_PAGE_SIZE` |
| Push batch size | ≤ 200 | `SyncConstants.pushBatchSize` | `SyncConstants.PUSH_BATCH_SIZE` |
| Tombstone retention | 90 days | `SyncConstants.tombstoneRetentionDays` | `SyncConstants.TOMBSTONE_RETENTION_DAYS` |
| WebSocket auth timeout | 5 s | `RealtimeConstants.authTimeout` | `RealtimeConstants.AUTH_TIMEOUT_MS` |
| WebSocket max message | 64 KiB | `RealtimeConstants.maxMessageBytes` | `RealtimeConstants.MAX_MESSAGE_BYTES` |

</dd></dl>

## 13. Team

<dl><dd>

- Rules behind these calls: [05-team-and-roles](05-team-and-roles.md).

```json
GET /me
→ { "uid": "…", "email": "hanh@…", "name": "Hanh Nguyen", "role": "inspector", "projectIds": ["1111…"] }
```

- `role` is `admin`, `manager`, `inspector` or `viewer`; `projectIds` is `"all"` for Admin and Manager.

```json
GET /members
→ { "members": [ { "uid": "…", "email": "…", "name": "…", "role": "manager", "projectIds": "all", "lastSeenAt": "…" } ],
    "invitations": [ { "id": "…", "email": "…", "role": "viewer", "projectIds": ["1111…"], "expiresAt": "…" } ] }

POST /invitations { "email": "client@…", "role": "viewer", "projectIds": ["1111…"] }
→ { "invitationId": "…", "expiresAt": "…" }

GET /invitations/preview/:token  (no Authorization: the link itself is the key)
→ { "invitedBy": "Hanh Nguyen", "role": "inspector", "projects": [ { "id": "1111…", "name": "Riverside Tower B" } ],
    "email": "v••@eastline.vn", "expiresAt": "…" }

POST /invitations/accept { "token": "…" }
→ { "uid": "…", "role": "viewer", "projectIds": ["1111…"] }

POST /invitations/:id/resend
→ { "invitationId": "…", "expiresAt": "…" }

PATCH /members/:uid { "role": "manager" }                → { "uid": "…", "role": "manager", "projectIds": "all" }
PATCH /members/:uid { "projectIds": ["1111…", "2222…"] } → { "uid": "…", "role": "inspector", "projectIds": ["1111…", "2222…"] }
DELETE /members/:uid                        → { "removed": true }
PUT /projects/:id/members { "uids": ["…", "…"] }   → { "projectId": "…", "uids": ["…", "…"] }

GET /member-events?before=<id>&limit=50
→ { "events": [ { "id": "…", "at": "…", "actor": { "uid": "…", "name": "Hanh Nguyen" },
                  "type": "role_changed", "subject": { "uid": "…", "name": "Le Thu" }, "detail": { "from": "viewer", "to": "inspector" } } ],
    "next": "<id or null>" }
```

- `GET /invitations/preview/:token` never reveals the full email or marks the invite used; it is rate limited per IP (`429`). `PATCH /members/:uid` takes `role`, `projectIds` or both; `projectIds` is ignored for Admin and Manager (they reach every project).
- `type` in `member_events`: `invited` · `invite_resent` · `invite_cancelled` · `joined` · `role_changed` · `projects_changed` · `removed` · `account_deleted`.

| Error | When |
|---|---|
| `400 invalid_email` · `400 invalid_role` | Malformed body |
| `403 forbidden` | The caller's role may not do this |
| `404` | Unknown member, invitation or project; an invite token that never existed |
| `429` | Too many invite previews from one address |
| `409 already_member` | Invite for an email that is already a member |
| `409 invite_expired` · `409 invite_used` · `409 email_mismatch` | Accept with a bad token (preview: expired or used only) |
| `409 invite_accepted` | Resend or cancel an invite that was already accepted |
| `409 last_admin` | Removing, demoting or deleting the last Admin |

</dd></dl>
