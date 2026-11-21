# SiteLog backend

<dl><dd>

- The server behind the SiteLog [iOS](https://github.com/DAMHONGDUC/site_log_swift_ui) and [Android](https://github.com/DAMHONGDUC/site-log-android) apps: sign-in check, delta sync, presigned S3 uploads, verification codes, realtime upload state, push (Firebase Cloud Messaging).
- Node 24 · TypeScript · Fastify · PostgreSQL 16 (Drizzle ORM) · AWS (EC2 + Docker Compose, RDS, S3), infrastructure in AWS CDK.
- Built step by step from the guides in [docs/feature-guide](docs/feature-guide/README.md), sprint by sprint, next to the iOS and Android apps.

</dd></dl>

## Contents

<dl><dd>

1. [Status](#status)
2. [Quick start](#quick-start)
3. [Docs](#docs)
4. [API endpoints](#api-endpoints)
5. [Repository layout](#repository-layout)
6. [Code structure](#code-structure)
7. [Commands](#commands)

</dd></dl>

## Status

<dl><dd>

- The code of S0–S10 is in the repository: every call of [01-api §3](docs/feature-docs/01-api.md#3-endpoints), the worker, migrations `0001`–`0012`, the AWS CDK app (`infra/`) and CI. `npm test`: 104 tests green against Postgres 16; format, lint, typecheck, the OpenAPI check, build and `cdk synth` pass.
- Not running anywhere yet: AWS, Firebase and SES accounts, DNS and the first deploy are still to do ([ROADMAP](docs/ROADMAP.md) P0, S0.3, S9, S10.9, P4).
- S0–S9 code comes from the guides as written; S10 (team and roles) was built from [05-team-and-roles](docs/feature-docs/05-team-and-roles.md) and is described in [F19](docs/feature-guide/S10-team-roles/F19-team-roles.md).

</dd></dl>

## Quick start

<dl><dd>

- The backend runs on your Mac with Postgres and S3 (RustFS) in Docker; full steps, app wiring and memory tips: [local development](docs/feature-guide/local-development.md).

```bash
cp .env.example .env
```

- Fill `FIREBASE_SERVICE_ACCOUNT_BASE64` in `.env`, then start everything (Docker, packages, migrations, bucket, API and worker; Ctrl+C stops it):

```bash
npm run dev:all
```

```bash
curl localhost:3000/health
```

</dd></dl>

## Docs

<dl><dd>

| Doc | Holds |
|---|---|
| [00-overview](docs/feature-docs/00-overview.md) | What the backend does, architecture, stack, decisions, environments, cost |
| [01-api](docs/feature-docs/01-api.md) | Every endpoint and message: request, response, errors — the contract the app codes against |
| [02-database](docs/feature-docs/02-database.md) | Tables, sync columns, keys, migrations |
| [03-sync-uploads-realtime](docs/feature-docs/03-sync-uploads-realtime.md) | How sync, uploads, verification and the WebSocket channel work inside |
| [04-aws-operations](docs/feature-docs/04-aws-operations.md) | AWS resources, configuration, secrets, deploy, logs, alarms, backups |
| [05-team-and-roles](docs/feature-docs/05-team-and-roles.md) | One company, four roles, project members, invitations, shared sync |
| [ROADMAP](docs/ROADMAP.md) | Plan to finish the backend: phases, steps with hours and ticks, done-when, risks |
| [Feature guides](docs/feature-guide/README.md) | Step-by-step build, one folder per sprint |
| [Local development](docs/feature-guide/local-development.md) | Postgres and S3 (RustFS) in Docker, the API on your Mac, the iOS and Android apps pointed at it |
| [Local testing with iOS](docs/feature-guide/local-testing-with-ios.md) | Run the backend on your Mac and point the simulator or an iPhone at it |
| [App design](https://github.com/DAMHONGDUC/site_log_swift_ui/blob/main/docs/design/00-design-plan.md) | No UI here; the app screens the API serves (Team and roles: T1–T8) are in the iOS repo's design pages and the [Figma file](https://www.figma.com/design/uJZcCP6lzw8QTSkcu8uqvV/Site-Log-iOS-Design) |

</dd></dl>

## API endpoints

<dl><dd>

- Every call the apps make: 24 method + path pairs (01-api §3 lists them in 23 rows; `PATCH` and `DELETE /members/:uid` share one). The contract (bodies, errors) is [01-api](docs/feature-docs/01-api.md); this list mirrors its [§3](docs/feature-docs/01-api.md#3-endpoints) — change both together.
- Base URL `https://api.<domain>`; `Bearer` = Firebase ID token in `Authorization`; errors follow [§2](docs/feature-docs/01-api.md#2-error-contract). The file bytes go straight to S3 with the presigned `PUT` URLs, not through this server.

| # | Group | Method | Path | Auth | Does | Spec | Feature |
|---|---|---|---|---|---|---|---|
| 1 | Health | `GET` | `/health` | none | Liveness: `200 ok` or `503 database_unreachable` | [§](docs/feature-docs/01-api.md#4-health) | F00 |
| 2 | Account | `DELETE` | `/account` | Bearer | Leave the company: Firebase user, devices, phrases go; company records stay | [§](docs/feature-docs/01-api.md#5-account) | F02 · F19 |
| 3 | Sync | `POST` | `/sync/pull` | Bearer | Changes since a cursor, reachable projects only | [§](docs/feature-docs/01-api.md#61-pull) | F04 |
| 4 | Sync | `POST` | `/sync/push` | Bearer | Apply a batch of mutations; refused ones come back `rejected` | [§](docs/feature-docs/01-api.md#62-push) | F04 |
| 5 | Uploads and media | `POST` | `/uploads` | Bearer | Begin: one presigned PUT or a multipart plan | [§](docs/feature-docs/01-api.md#72-begin) | F06 · F07 |
| 6 | Uploads and media | `POST` | `/uploads/:id/parts/refresh` | Bearer | New URLs for expired parts | [§](docs/feature-docs/01-api.md#73-refresh-part-urls-f07) | F07 |
| 7 | Uploads and media | `POST` | `/uploads/:id/complete` | Bearer | Confirm, record, issue a verification code (idempotent) | [§](docs/feature-docs/01-api.md#74-complete) | F06 |
| 8 | Uploads and media | `DELETE` | `/uploads/:id` | Bearer | Abort (idempotent) | [§](docs/feature-docs/01-api.md#75-abort) | F06 |
| 9 | Uploads and media | `POST` | `/media/urls` | Bearer | GET URLs for stored files | [§](docs/feature-docs/01-api.md#8-media-urls) | F06 |
| 10 | Verify | `GET` | `/verify/:code` | none | Facts about a code printed in a report | [§](docs/feature-docs/01-api.md#9-verify) | F10 |
| 11 | Realtime and push | `WS` | `/ws` | first message | Live upload state for open sessions | [§](docs/feature-docs/01-api.md#11-websocket) | F15 |
| 12 | Realtime and push | `POST` | `/devices` | Bearer | Register an FCM token | [§](docs/feature-docs/01-api.md#10-devices) | F16 |
| 13 | Realtime and push | `DELETE` | `/devices/:token` | Bearer | Remove it on sign-out | [§](docs/feature-docs/01-api.md#10-devices) | F16 |
| 14 | Team | `GET` | `/me` | Bearer | The caller: role, reachable projects | [§](docs/feature-docs/01-api.md#13-team) | F19 |
| 15 | Team | `GET` | `/members` | Bearer · Admin, Manager | Members with roles and projects, pending invitations | [§](docs/feature-docs/01-api.md#13-team) | F19 |
| 16 | Team | `POST` | `/invitations` | Bearer · Admin | Invite an email with a role and projects | [§](docs/feature-docs/01-api.md#13-team) | F19 |
| 17 | Team | `POST` | `/invitations/accept` | Bearer | Join with an invite token | [§](docs/feature-docs/01-api.md#13-team) | F19 |
| 18 | Team | `GET` | `/invitations/preview/:token` | none | Preview an invite before sign-in (T5): inviter, role, projects, masked email | [§](docs/feature-docs/01-api.md#13-team) | F19 |
| 19 | Team | `POST` | `/invitations/:id/resend` | Bearer · Admin | New token and email; the old link stops working | [§](docs/feature-docs/01-api.md#13-team) | F19 |
| 20 | Team | `DELETE` | `/invitations/:id` | Bearer · Admin | Cancel an invite | [§](docs/feature-docs/01-api.md#13-team) | F19 |
| 21 | Team | `PATCH` | `/members/:uid` | Bearer · Admin | Change a role and / or projects (T3) | [§](docs/feature-docs/01-api.md#13-team) | F19 |
| 22 | Team | `DELETE` | `/members/:uid` | Bearer · Admin | Remove a member | [§](docs/feature-docs/01-api.md#13-team) | F19 |
| 23 | Team | `PUT` | `/projects/:id/members` | Bearer · Admin, Manager | Set who works on a project | [§](docs/feature-docs/01-api.md#13-team) | F19 |
| 24 | Team | `GET` | `/member-events` | Bearer · Admin | Team activity log (T9), newest first, paged | [§](docs/feature-docs/01-api.md#13-team) | F19 |

</dd></dl>

## Repository layout

<dl><dd>

```text
site-log-be/
├── src/
│   ├── main.ts · worker.ts # entry points: HTTP + WebSocket server · background jobs
│   ├── app.ts              # composition root: builds Database, services, guards, registers routes
│   ├── services.ts         # builds every service once (API and worker)
│   ├── constants/          # every fixed value, by kind:
│   │                       #   http/ (ApiRoutes, ErrorCode, HTTP status, OpenAPI) · data/ (table and
│   │                       #   enum names, enum values) · domain/ (roles + permissions, push kinds,
│   │                       #   issues, object keys, team, realtime) · runtime/ (limits, patterns, durations,
│   │                       #   units, env names, WebSocket close codes) · messages/ (log, error, push, mail
│   │                       #   and script text) · platform/ (encodings, Firebase/FCM/S3/Postgres codes)
│   ├── core/               # config, logger, errors, auth, log; http/ (guards, schemas, openapi)
│   ├── data/               # pool, Database (repositories on the pool or one transaction), Drizzle client,
│   │                       # schema/ (every table, for typed queries)
│   ├── integrations/       # S3 storage, SES mailer, FCM sender
│   ├── modules/            # one folder per feature, one Fastify plugin each; index.ts is its public API:
│   │                       # *-routes (plugin) · *-service · *-repository · rules
│   │   ├── account/  devices/  health/  notifications/
│   │   ├── realtime/       # WebSocket channel and pg_notify fan-out
│   │   ├── sync/           # table registry, pull, push/ (sql · placement · authorization · apply),
│   │   │                   # repositories/ (projects, phrases, issues, rev counter)
│   │   ├── team/           # members/ · invitations/ · access/ (reach, permissions, project members)
│   │   └── uploads/        # transfer/ (uploads) · media/ (media URLs) · verify/ (/verify) ·
│   │                       # keys/ (object keys, key migration)
│   └── workers/            # worker jobs
├── migrations/             # numbered .sql files, run once each, forward only
├── test/                   # vitest against a real Postgres: core/, data/, modules/<feature>/ (sync: engine/ ·
│                           # tables/), helpers/
├── scripts/                # dev token, seed the first Admin, move pre-F19 keys, OpenAPI
├── docs/                   # feature docs, guides, openapi.json (generated)
├── deploy/ · infra/        # what runs on EC2 · AWS CDK app
├── tools/docs/             # Markdown indenter
└── .github/                # CI, deploy, Dependabot, CODEOWNERS, PR and issue templates
```

</dd></dl>

## Code structure

<dl><dd>

| Rule | How it is kept |
|---|---|
| One folder per feature | `src/modules/<feature>/` holds that feature's routes, services and repositories; shared code lives in `core/`, `data/`, `integrations/`, `constants/` |
| Features are Fastify plugins | Each feature's routes are an encapsulated plugin registered from `FEATURE_PLUGINS` in `app.ts`; it reads `app.deps` (config, db, services, storage, hub) and `app.guards`, decorated once on the root instance |
| Features meet through `index.ts` | Code outside `modules/<feature>/` imports it only from `modules/<feature>/index.ts`; `constants/` imports only constants. Two local ESLint rules (`tools/eslint/boundaries.js`) fail otherwise |
| Routes are thin | A route only declares its schema and guard, calls one service, returns the result |
| SQL only in repositories | Repositories query through Drizzle (`src/data/schema/`); ESLint fails on `.query(` or a `drizzle-orm` import anywhere in `src/modules` and `src/core` except `*-repository.ts` and the sync and realtime engines. The sync push and pull keep raw SQL: they build it from `syncTables` metadata (`jsonb_populate_record`, savepoints) |
| Migrations own the schema | `migrations/*.sql` create the tables; `src/data/schema/` only describes them for Drizzle. `test/data/schema.test.ts` fails when a column or its nullability differs, or a synced table is missing |
| No hard-coded strings | Every string value is a named constant in `src/constants/`: table and enum names in `data/db.ts`, enum values in `data/enums.ts` (`UPLOAD_STATE.completed`, `ROLE.admin`), sync values in `data/sync.ts`, every log, error, push and mail text in `messages/`, codes of outside services in `platform/`. ESLint fails on a string literal in `src/` and `scripts/` outside those files; it lets through `''`, `typeof` checks, SQL handed to `query()`, Drizzle `sql` templates, and the sync table registry and SQL builder (`sync/tables.ts`, `sync/pull.ts`, `sync/push/sql.ts`) |
| Features grouped by folder | A folder holds at most 6 files; past that it splits into one sub-folder per sub-feature (`team/members/`, `team/invitations/`, `team/access/`) |
| Every path from `ApiRoutes` | `src/constants/http/api-routes.ts` holds every endpoint (`ApiRoutes.UPLOAD_COMPLETE`, `ApiRoutes.uploadComplete(id)`); ESLint fails on a literal path in a route; tests build paths with it |
| No magic numbers | ESLint `no-magic-numbers` on `src/` (constants and Config excepted) |
| Small files | ESLint `max-lines` 300 per file |
| Depend on interfaces | Services take `TokenVerifier`, `PushSender`, `Mailer`, `Storage`, `Database` through the constructor; tests pass fakes |
| Open for extension | A new role or action: `ROLE_PERMISSIONS`; a new push kind: `PUSH_KINDS` + one template in `PUSH_TEMPLATES`; a new synced table: one entry in `syncTables`; a new endpoint: `ApiRoutes` + a route + a service method |
| One transaction, many repositories | `db.transaction((repos) => …)` gives every repository the same client |
| Clean shutdown | `app.close()` finishes open requests; an `onClose` hook in `main.ts` then stops the realtime listener and ends the pool |
| API contract | `docs/openapi.json` is generated from the route schemas (`npm run openapi`); CI fails when it is stale; `/docs` serves the explorer outside production |

- The S0–S9 guides show the first form of each file (all in the route, under the old flat folders); the repository has since been split into these layers and feature folders with the same behaviour and tests.

</dd></dl>

## Commands

<dl><dd>

| Command | Does |
|---|---|
| `npm run dev` | API with reload, reads `.env` |
| `npm run worker:dev` | Worker with reload |
| `npm run dev:all` | Everything local in one go: Docker, packages, migrations, bucket, API and worker |
| `npm run dev:stop` | Stops the API, the worker and the containers (data stays); `-- --colima` also stops Colima |
| `npm run migrate` | Runs new migrations |
| `npm run s3:bucket` | Creates the bucket on the local S3 server, once |
| `npm test` | All tests against `sitelog_test` |
| `npm run lint` · `npm run typecheck` · `npm run format` | Code checks |
| `npm run token -- <email> <password>` | A Firebase ID token for curl |
| `npm run seed:admin -- <email> <firebase-uid>` | Creates the first Admin, once (F19) |
| `npm run openapi` · `npm run openapi:check` | Writes `docs/openapi.json` · fails when it is out of date |
| `npm run move-keys` | Moves pre-F19 file keys to `projects/…` and `company/…`, once after migration `0012` |
| `cd infra && npx cdk deploy SiteLog-Staging` | Creates or updates the staging AWS resources |
| `python3 tools/docs/indent-md.py` | Re-indents every `.md` after an edit |

</dd></dl>
