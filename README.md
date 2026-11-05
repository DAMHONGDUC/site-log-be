# SiteLog backend

<dl><dd>

- The server behind the [SiteLog iOS app](https://github.com/DAMHONGDUC/site_log_swift_ui): sign-in check, delta sync, presigned S3 uploads, verification codes, realtime upload state, push.
- Node 24 · TypeScript · Fastify · PostgreSQL 16 · AWS (EC2 + Docker Compose, RDS, S3), infrastructure in AWS CDK.
- Built step by step from the guides in [docs/feature-guide](docs/feature-guide/README.md), sprint by sprint, next to the iOS app.

</dd></dl>

## Contents

<dl><dd>

1. [Status](#status)
2. [Quick start](#quick-start)
3. [Docs](#docs)
4. [Repository layout](#repository-layout)
5. [Commands](#commands)

</dd></dl>

## Status

<dl><dd>

- This repository holds the docs only. The code is written by following the guides, starting with [S0](docs/feature-guide/S0-foundation/README.md).
- Every code block in the guides was compiled, linted and tested (Postgres 16, Node 24) before it was written down.

</dd></dl>

## Quick start

<dl><dd>

- After S0 the backend runs on your Mac like this (full steps: [F00a](docs/feature-guide/S0-foundation/F00a-setup.md), [local testing with the app](docs/feature-guide/local-testing-with-ios.md)):

```bash
docker compose up -d
```

```bash
cp .env.example .env
```

```bash
npm ci && npm run migrate && npm run dev
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
| [Feature guides](docs/feature-guide/README.md) | Step-by-step build, one folder per sprint |
| [Local testing with iOS](docs/feature-guide/local-testing-with-ios.md) | Run the backend on your Mac and point the simulator or an iPhone at it |

</dd></dl>

## Repository layout

<dl><dd>

```text
site-log-be/
├── src/                    # the API and the worker (TypeScript)
│   ├── main.ts             # starts the HTTP + WebSocket server
│   ├── worker.ts           # background jobs: verify uploads, abort abandoned ones, purge tombstones
│   ├── app.ts              # builds the Fastify app from its dependencies
│   ├── routes/             # one file per group of endpoints
│   ├── sync/               # pull, push, the table registry
│   ├── realtime/           # WebSocket channel and pg_notify fan-out
│   ├── workers/            # the worker's jobs
│   └── push/               # APNs
├── migrations/             # numbered .sql files, run once each, forward only
├── test/                   # vitest against a real Postgres
├── deploy/                 # what runs on the EC2 server: compose.yml, Caddyfile, deploy.sh
├── infra/                  # AWS CDK app: every AWS resource
├── .github/                # CI and deploy workflows
├── docs/                   # specs (feature-docs) and guides (feature-guide)
├── Tools/Docs/indent-md.py # run after editing any .md
├── docker-compose.yml      # local Postgres
└── Dockerfile              # the one image: API, worker and migrations
```

</dd></dl>

## Commands

<dl><dd>

| Command | Does |
|---|---|
| `npm run dev` | API with reload, reads `.env` |
| `npm run worker:dev` | Worker with reload |
| `npm run migrate` | Runs new migrations |
| `npm test` | All tests against `sitelog_test` |
| `npm run lint` · `npm run typecheck` · `npm run format` | Code checks |
| `npm run token -- <email> <password>` | A Firebase ID token for curl |
| `cd infra && npx cdk deploy SiteLog-Staging` | Creates or updates the staging AWS resources |
| `python3 Tools/Docs/indent-md.py` | Re-indents every `.md` after an edit |

</dd></dl>
