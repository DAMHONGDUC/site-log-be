# F19 — Team and roles (backend)

<dl><dd>

- Sprint [S10](README.md) · 16h · skeleton guide — parts, files, order, tests. Code is added when the feature starts.
- Rules: [05-team-and-roles](../../feature-docs/05-team-and-roles.md) · contract: [01-api §13](../../feature-docs/01-api.md#13-team) · tables: [02-database](../../feature-docs/02-database.md) · why: [B10](../../feature-docs/00-overview.md#b10--one-company-four-roles-shared-projects).
- App side: [iOS F19](https://github.com/DAMHONGDUC/site_log_swift_ui/blob/main/docs/feature-guide/S10-team-roles/F19-team-roles.md) · [Android F19](https://github.com/DAMHONGDUC/site-log-android/blob/main/docs/feature-guide/S10-team-roles/F19-team-roles.md).

</dd></dl>

## Contents

<dl><dd>

1. [Overview](#overview)
2. [1. Migration](#1-migration)
3. [2. Access](#2-access)
4. [3. Sync scope](#3-sync-scope)
5. [4. Files](#4-files)
6. [5. Team API and invites](#5-team-api-and-invites)
7. [6. Realtime and push](#6-realtime-and-push)
8. [Tests](#tests)
9. [Feature done](#feature-done)

</dd></dl>

## Overview

<dl><dd>

- **Goal:** one company, four roles, shared projects. Every route, the sync pull and push, the upload signer, the WebSocket and push ask one function who can reach what.
- **Demo:** the Admin invites an Inspector to Riverside Tower B; the Inspector signs in from the email, sees only that project, logs an issue the Admin then sees; a Viewer's push of an issue is `rejected` with `forbidden:issue.create`.

| Step | Hours | Files |
|---|---|---|
| [1](#1-migration) | 3 | `migrations/0012_team.sql` |
| [2](#2-access) | 2 | `src/team/access.ts`, `src/team/permissions.ts`, `src/auth.ts`, `scripts/seed-admin.ts` |
| [3](#3-sync-scope) | 3 | `src/sync/pull.ts`, `src/sync/push.ts`, `src/sync/tables.ts` |
| [4](#4-files) | 2 | `src/keys.ts`, `src/routes/uploads.ts`, `src/routes/media.ts`, `scripts/move-keys.ts` |
| [5](#5-team-api-and-invites) | 3 | `src/routes/team.ts`, `src/team/invitations.ts`, `src/mail/ses.ts`, `src/routes/account.ts` |
| [6](#6-realtime-and-push) | 1 | `src/realtime/ws.ts`, `src/workers/verify.ts` |
| [Tests](#tests) | 2 | `test/team.test.ts`, `test/access.test.ts`, `test/sync-scope.test.ts` |

```mermaid
flowchart LR
    Token["ID token"] --> Member{"member?"}
    Member -->|no| NI["403 not_invited"]
    Member -->|yes| Reach["reachable(uid)<br/>can(role, action)"]
    Reach --> Routes["routes"]
    Reach --> Pull["sync pull: project_id in reachable"]
    Reach --> Push["sync push: rejected forbidden:action"]
    Reach --> Files["upload / media: project check"]
    Reach --> WS["WebSocket · push"]
```

</dd></dl>

## 1. Migration

<dl><dd>

- **Goal:** rows belong to a project and keep who made them; the company has one rev counter.

| Change | Detail |
|---|---|
| New | `member_role` enum; `members`, `invitations`, `project_members`, `member_events` |
| Every synced table | Add `project_id` (fill child tables from their parent: captures → session, annotations → capture, issue_captures → issue, checklist rows → run / session); rename `uid` → `created_by`; index `(project_id, rev)` |
| `issues` | Add `assignee_uid text null` (a member); keep `assignee_name` for subcontractors without the app |
| `phrases` | Keep `uid`: personal |
| `report_branding` | Keep one row, the company's |
| `sync_state` | One row: `last_rev` = max of the old per-user counters; every member gets `resync_required = true` |
| Foreign keys | `(project_id, …)` instead of `(uid, …)` |

- **Check:** the migration runs on a copy of staging; row counts per table are unchanged; every row has a `project_id`.

</dd></dl>

## 2. Access

<dl><dd>

- **Goal:** one place decides membership, reach and permission.

| File | Holds |
|---|---|
| `src/team/access.ts` | `loadMember(uid)`, `reachable(member)` (all for Admin / Manager, `project_members` otherwise) |
| `src/team/permissions.ts` | The table of [05 §3](../../feature-docs/05-team-and-roles.md#3-permissions) as data: `can(role, action, row?)`, including "own, same day" |
| `src/auth.ts` | After the token: no member → `403 not_invited`; removed member → `401` |
| `scripts/seed-admin.ts` | `npm run seed:admin -- <email>`: the first Admin, once |

- **Check:** a token of a stranger gets `403 not_invited`; the seeded Admin gets `200` on `GET /me`.

</dd></dl>

## 3. Sync scope

<dl><dd>

- **Goal:** pull returns reachable projects only; push refuses what the role may not do.

| Part | Rule |
|---|---|
| Pull | Every table query adds `project_id = any($reachable)`; `phrases` keep `uid = $me` |
| Push | Before applying a mutation: `can(role, action, existing row)`; refused → `rejected` with `forbidden:<action>` (e.g. `forbidden:plan_sheet.upsert`) |
| Resync | `members.resync_required` → pull answers `resyncRequired`, then clears the flag |
| Rev | Lock the single `sync_state` row instead of the user's |

- **Check:** two Inspectors on different projects never see each other's rows; a Viewer's push is rejected row by row, the rest of the batch applies.

</dd></dl>

## 4. Files

<dl><dd>

- **Goal:** file keys follow the project, not the person.

| Part | Rule |
|---|---|
| Keys | `projects/{projectId}/…`, `company/branding/…` ([01-api §7.1](../../feature-docs/01-api.md#71-keys)) |
| Begin upload | The caller may write that project, else `403 forbidden` |
| Media URLs | Every key in a reachable project |
| Old objects | `scripts/move-keys.ts`: copy `{uid}/{projectId}/…` → `projects/{projectId}/…`, update `remote_key`, delete the old object after a check; resumable, logs counts |

- **Check:** a Viewer gets GET URLs for their project's photos and `403` on begin upload.

</dd></dl>

## 5. Team API and invites

<dl><dd>

- **Goal:** the seven calls of [01-api §13](../../feature-docs/01-api.md#13-team) and the invite email.

| Part | Rule |
|---|---|
| Invite | Random 32-byte token, store its SHA-256, 7 days; email from `INVITE_FROM_EMAIL` through Amazon SES with `INVITE_BASE_URL/invite/<token>` |
| Accept | Token valid, unused, email equals the signed-in email → member row, project rows, `member_events` |
| Role change, project change, removal | Admin only (projects: Admin, Manager); write `member_events`; set `resync_required`; removal revokes Firebase tokens and deletes devices |
| Last Admin | `409 last_admin` |
| `DELETE /account` | Identity, phrases and devices only; company rows stay |

- AWS: verify the sender identity in SES (staging: sandbox, verified recipients only).
- **Check:** invite → email → accept works on staging with a verified recipient.

</dd></dl>

## 6. Realtime and push

<dl><dd>

- **Goal:** live events and pushes reach the project's members, nobody else.
- WebSocket `subscribe`: the session's project must be reachable, else close `4003`.
- Push "uploads verified": every member who reaches the project and has a device.

</dd></dl>

## Tests

<dl><dd>

| Test | Proves |
|---|---|
| `access.test.ts` | `reachable` and `can` match the permission table, row by row |
| `sync-scope.test.ts` | Pull isolation between projects; push `forbidden:<action>`; `resyncRequired` after a role change |
| `team.test.ts` | Invite, accept (expired, used, wrong email), role change, removal, last Admin |

</dd></dl>

## Feature done

<dl><dd>

| Check | How |
|---|---|
| Tests | `npm test` green |
| Staging | The demo above, with two phones signed in as Admin and Inspector |
| Data | Old objects moved; no key starts with a uid |
| Roadmap | F19 steps ticked |

</dd></dl>
