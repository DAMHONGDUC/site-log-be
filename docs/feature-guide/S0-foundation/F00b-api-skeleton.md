# F00b — API skeleton

<dl><dd>

- Sprint [S0](README.md) · 5h · a Fastify server on your Mac that talks to Postgres, runs migrations, answers `/health`, has tests, an image and CI.
- Before: [F00a Setup](F00a-setup.md). Next: [F00c AWS staging](F00c-aws-staging.md).

</dd></dl>

## Contents

<dl><dd>

1. [Overview](#overview)
2. [Target structure](#target-structure)
3. [1. Project files](#1-project-files)
4. [2. Local Postgres](#2-local-postgres)
5. [3. Config, logger, database](#3-config-logger-database)
6. [4. Error contract, app, health](#4-error-contract-app-health)
7. [5. Migration runner](#5-migration-runner)
8. [6. Tests](#6-tests)
9. [7. Docker image](#7-docker-image)
10. [8. CI](#8-ci)
11. [Feature done](#feature-done)

</dd></dl>

## Overview

<dl><dd>

- **Goal:** the ground every feature builds on: settings, database, error contract, migrations, tests, image, CI.
- **Demo:** `curl localhost:3000/health` → `{"status":"ok"}`; `npm test` green; a PR runs CI.
- **Specs:** [00-overview](../../feature-docs/00-overview.md) (stack, conventions), [01-api §2](../../feature-docs/01-api.md#2-error-contract) (error contract).
- **How to use:** per file, answer **Think**, write it, open **Hint 1 → 3** only when stuck, compare with **Code**, then do **Try**.
- **File tags:** <b class="tag-new">New</b> create · <b class="tag-edit">Edit</b> change the part shown · <b class="tag-replace">Replace</b> overwrite · <b class="tag-check">Check</b> already there, compare only.

| Step | Hours | Builds | Check |
|---|---|---|---|
| [1](#1-project-files) | 0.5 | `package.json`, TypeScript, ESLint, Prettier | `npx tsc -v` |
| [2](#2-local-postgres) | 0.5 | Postgres 16 in Docker | `docker compose ps` healthy |
| [3](#3-config-logger-database) | 1 | `config.ts`, `logger.ts`, `db.ts` | `npm run typecheck` |
| [4](#4-error-contract-app-health) | 1 | `errors.ts`, `app.ts`, `routes/health.ts`, `main.ts` | `curl localhost:3000/health` |
| [5](#5-migration-runner) | 1 | `migrate.ts`, `migrations/` | `npm run migrate` |
| [6](#6-tests) | 0.5 | vitest, test database, first tests | `npm test` |
| [7](#7-docker-image) | 0.25 | `Dockerfile` | `docker build .` |
| [8](#8-ci) | 0.25 | `.github/workflows/ci.yml` | a PR is green |

```mermaid
flowchart LR
    Curl["curl / iOS app"] --> Fastify["Fastify<br/>app.ts"]
    Fastify --> Health["routes/health.ts"]
    Health --> Pool["pg.Pool<br/>db.ts"]
    Pool --> PG[("Postgres 16<br/>Docker")]
    Fastify -->|"any error"| Err["errors.ts<br/>{ error: { code, message } }"]
    Migrate["migrate.ts"] --> PG
    Config[".env → config.ts"] --> Fastify
```

</dd></dl>

## Target structure

<dl><dd>

```text
site-log-be/
├── package.json · package-lock.json      # 1
├── tsconfig.json · tsconfig.build.json   # 1
├── eslint.config.js · .prettierrc.json · .prettierignore   # 1
├── .env.example                          # 1 (.env is yours, never committed)
├── docker-compose.yml                    # 2
├── src/
│   ├── config.ts · logger.ts · db.ts     # 3
│   ├── errors.ts · app.ts · main.ts      # 4
│   ├── routes/health.ts                  # 4
│   └── migrate.ts                        # 5
├── migrations/                           # 5: empty until F03
├── vitest.config.ts                      # 6
├── test/
│   ├── global-setup.ts · helpers.ts      # 6
│   └── health.test.ts · migrate.test.ts  # 6
├── Dockerfile · .dockerignore            # 7
└── .github/workflows/ci.yml              # 8
```

</dd></dl>

## 1. Project files

<dl><dd>

#### Overview

<dl><dd>

- **Goal:** a TypeScript project that formats and lints itself.
- **Check:** `npx tsc -v` prints `Version 6.0.x`; `npm run lint` runs (nothing to lint yet).

| Action | File | Holds |
|---|---|---|
| <b class="tag-new">New</b> | `package.json` | ES modules, Node 24, the scripts every guide uses |
| <b class="tag-new">New</b> | `tsconfig.json`, `tsconfig.build.json` | Strict TypeScript; the build compiles `src/` only |
| <b class="tag-new">New</b> | `eslint.config.js`, `.prettierrc.json`, `.prettierignore` | Lint rules (no `console`), format rules |
| <b class="tag-new">New</b> | `.env.example` | Every setting with a comment; copy to `.env` |
| <b class="tag-check">Check</b> | `.gitignore` | `.env`, keys, build output never committed |

```mermaid
flowchart LR
    Src["src/*.ts"] -->|"tsx (dev)"| Run["node runs TS directly"]
    Src -->|"tsc (build)"| Dist["dist/*.js"]
    Src -->|"eslint · prettier"| Clean["checked, formatted"]
```

</dd></dl>

#### Steps

<dl><dd>

<details open>
<summary><strong>1.1 Create the project and install</strong></summary>
<dl><dd>

<b>Explain</b> · `npm init` writes `package.json`; `npm install` adds packages and pins exact versions in `package-lock.json` (commit both).

<b>Think</b>

- Why do `typescript` and `vitest` go in `devDependencies` but `fastify` in `dependencies`? Which ones does the server need at run time?

```bash
npm init -y
```

```bash
npm install fastify @fastify/type-provider-typebox typebox pg pino
```

```bash
npm install -D typescript tsx vitest @types/node@24 @types/pg eslint @eslint/js typescript-eslint prettier
```

<b>File</b> · <b class="tag-edit">Edit</b> · `package.json`

<b>Explain</b> · Keep the `dependencies` npm wrote; set `type`, `engines` and `scripts` as below.

<details>
<summary><b>Code</b></summary>

```json
{
  "name": "site-log-be",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "dev": "tsx watch --env-file-if-exists=.env src/main.ts",
    "worker:dev": "tsx watch --env-file-if-exists=.env src/worker.ts",
    "migrate": "tsx --env-file-if-exists=.env src/migrate.ts",
    "token": "tsx --env-file-if-exists=.env scripts/dev-token.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/main.js",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest run"
  }
}
```

</details>

<b>Try</b>

- Run `npm run dev` now: what error do you get, and why is it fine (there is no `src/main.ts` yet)?

</dd></dl>
</details>

<details open>
<summary><strong>1.2 TypeScript</strong></summary>
<dl><dd>

<b>File</b> · <b class="tag-new">New</b> · `tsconfig.json`

<b>Explain</b> · Strict type checking for everything, including tests. `nodenext` means real Node ES modules: imports end in `.js` even in `.ts` files.

<b>Think</b>

- `noUncheckedIndexedAccess` makes `rows[0]` have type `Row | undefined`. Which bug does that catch when a query returns nothing?

<details open>
<summary><b>Hint 1 · Idea</b></summary>

- Target a recent JavaScript, Node module rules, strict mode, output to `dist/`.

</details>

<details>
<summary><b>Code</b></summary>

```json
{
  "compilerOptions": {
    "target": "es2023",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src", "test", "scripts", "vitest.config.ts", "eslint.config.js"]
}
```

</details>

---

<b>File</b> · <b class="tag-new">New</b> · `tsconfig.build.json`

<b>Explain</b> · The build compiles only `src/` into `dist/` (tests and scripts stay out of the image).

<details>
<summary><b>Code</b></summary>

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

</details>

<b>Try</b>

- In a scratch file write `import { x } from './y'` without `.js` and run `npx tsc --noEmit`: read the error, then delete the file.

</dd></dl>
</details>

<details open>
<summary><strong>1.3 Lint and format</strong></summary>
<dl><dd>

<b>File</b> · <b class="tag-new">New</b> · `eslint.config.js`

<b>Explain</b> · Recommended JavaScript and TypeScript rules, plus `no-console`: logs go through the logger.

<details>
<summary><b>Code</b></summary>

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'infra/cdk.out', 'infra/node_modules'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      // Logging goes through the Fastify / pino logger, never console.
      'no-console': 'error',
    },
  },
);
```

</details>

---

<b>File</b> · <b class="tag-new">New</b> · `.prettierrc.json` and `.prettierignore`

<b>Explain</b> · Single quotes, 100-column lines; never format build output or the lock file.

<details>
<summary><b>Code</b></summary>

```json
{
  "singleQuote": true,
  "printWidth": 100
}
```

```text
dist
coverage
package-lock.json
infra/cdk.out
```

</details>

<b>Try</b>

- Write `console.log('hi')` in a scratch `.ts` file, run `npm run lint`, read the rule name, delete the file.

</dd></dl>
</details>

<details open>
<summary><strong>1.4 Settings files</strong></summary>
<dl><dd>

<b>File</b> · <b class="tag-new">New</b> · `.env.example`

<b>Explain</b> · Every setting with where to get it. Committed; your real `.env` is a copy with values and is ignored by git.

<b>Think</b>

- Why does the example hold `S3_BUCKET` and Firebase lines although F00b uses neither? (Hint: `config.ts` reads them all from the start.)

<details>
<summary><b>Code</b></summary>

```bash
# Copy to .env (never committed) and fill in. `npm run dev` reads it.

# Local Postgres from docker-compose.yml
DATABASE_URL=postgres://sitelog:sitelog@localhost:5432/sitelog
TEST_DATABASE_URL=postgres://sitelog:sitelog@localhost:5432/sitelog_test

# Real S3 bucket from the SiteLog-Dev stack; your `aws sso login` session signs the URLs.
AWS_PROFILE=sitelog
AWS_REGION=ap-southeast-1
S3_BUCKET=sitelog-dev-123456789012

# Firebase dev project → Project settings → Service accounts → Generate new private key,
# then: base64 -i service-account.json
FIREBASE_SERVICE_ACCOUNT_BASE64=
# Firebase dev project → Project settings → General → Web API key (only for `npm run token`)
FIREBASE_WEB_API_KEY=

PORT=3000
LOG_LEVEL=info

# Defaults are fine; they must match the iOS app's UploadConstants.
# PRESIGN_TTL_SECONDS=3600
# SINGLE_PUT_THRESHOLD_BYTES=5242880
# PART_SIZE_BYTES=8388608

# F16 push (optional locally): APNs key from developer.apple.com → Keys
# APNS_KEY_P8_BASE64=
# APNS_KEY_ID=
# APNS_TEAM_ID=
# APNS_BUNDLE_ID=app.dd.site.log
```

</details>

```bash
cp .env.example .env
```

---

<b>File</b> · <b class="tag-check">Check</b> · `.gitignore`

<b>Explain</b> · Already in the repo. `.env`, `*.pem` and `service-account*.json` can never be committed by accident.

<details>
<summary><b>Code</b></summary>

```text
node_modules/
dist/
.env
*.pem
service-account*.json
infra/cdk.out/
.DS_Store
```

</details>

<b>Try</b>

- `touch service-account-test.json && git status`: the file is not listed. Delete it.

</dd></dl>
</details>

</dd></dl>

</dd></dl>

## 2. Local Postgres

<dl><dd>

#### Overview

<dl><dd>

- **Goal:** Postgres 16 on your Mac in a container, data kept in a Docker volume.
- **Check:** `docker compose ps` shows `postgres` as `healthy`.

| Action | File | Holds |
|---|---|---|
| <b class="tag-new">New</b> | `docker-compose.yml` | `postgres:16`, user/password/db `sitelog`, port 5432, a health check |

```mermaid
flowchart LR
    API["npm run dev"] -->|"localhost:5432"| C["container postgres:16"]
    Tests["npm test"] -->|"sitelog_test"| C
    C --> V[("volume postgres-data")]
```

</dd></dl>

#### Steps

<dl><dd>

<details open>
<summary><strong>2.1 Compose file</strong></summary>
<dl><dd>

<b>File</b> · <b class="tag-new">New</b> · `docker-compose.yml`

<b>Explain</b> · Local Postgres only; production uses RDS (F00c). The dev database is `sitelog`; tests create `sitelog_test` next to it.

<b>Think</b>

- The volume keeps data when the container stops. What command throws the data away for a clean start?

<details open>
<summary><b>Hint 2 · APIs</b></summary>

- `services.postgres.image`, `environment` (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`), `ports`, `volumes`, `healthcheck` with `pg_isready`.

</details>

<details>
<summary><b>Code</b></summary>

```yaml
# Local Postgres for development and tests. Run: docker compose up -d
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: sitelog
      POSTGRES_PASSWORD: sitelog
      POSTGRES_DB: sitelog
    ports:
      - '5432:5432'
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U sitelog']
      interval: 2s
      retries: 15

volumes:
  postgres-data:
```

</details>

```bash
docker compose up -d
```

```bash
docker compose ps
```

<b>Try</b>

- `docker compose exec postgres psql -U sitelog -c 'select version()'`. Then `docker compose down -v` and `up -d` again: the data is gone (answer to Think).
- Port 5432 already used? Another Postgres runs on the Mac: stop it (`brew services stop postgresql`) or map `'5433:5432'` and change both URLs in `.env`.

</dd></dl>
</details>

</dd></dl>

</dd></dl>

## 3. Config, logger, database

<dl><dd>

#### Overview

<dl><dd>

- **Goal:** settings read once and checked; one logger; one connection pool with a transaction helper.
- **Check:** `npm run typecheck` is clean.

| Action | File | Holds |
|---|---|---|
| <b class="tag-new">New</b> | `src/config.ts` | `loadConfig()`: every environment variable, typed, defaults, fails fast |
| <b class="tag-new">New</b> | `src/logger.ts` | pino options shared by the API and the worker; hides the `Authorization` header |
| <b class="tag-new">New</b> | `src/db.ts` | `createPool()`, `connectionOptions()`, `withTransaction()`; bigint and date parsing |

```mermaid
flowchart LR
    Env[".env / server env"] --> Load["loadConfig()"] --> Config["Config object"]
    Config --> Pool["createPool()"] --> PG[("Postgres")]
    Route["a route"] --> Tx["withTransaction(pool, work)"]
    Tx -->|"begin · work · commit"| PG
    Tx -->|"error → rollback"| PG
```

</dd></dl>

#### Steps

<dl><dd>

<details open>
<summary><strong>3.1 Config</strong></summary>
<dl><dd>

<b>File</b> · <b class="tag-new">New</b> · `src/config.ts`

<b>Explain</b> · The only file that reads `process.env`. Everything else receives a `Config`, so tests pass their own values.

<b>Think</b>

- A missing `DATABASE_URL` could crash at the first query or at start-up. Which is better on a server, and why?
- Why is `loadConfig` given `env` as a parameter instead of reading `process.env` inside?

<details open>
<summary><b>Hint 1 · Idea</b></summary>

- Three helpers: `required(name)` throws when empty, `optional(name)` returns `undefined`, `integer(name, fallback)` parses and checks.
- `loadConfig(env)` returns one object with every setting.

</details>

<details open>
<summary><b>Hint 2 · APIs</b></summary>

- `Number(text)`, `Number.isInteger(value)`, `Buffer.from(text, 'base64').toString('utf8')`, the `??` default.

</details>

<details open>
<summary><b>Hint 3 · Skeleton</b></summary>

```ts
type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  // 1. read env[name]; 2. empty or missing → throw new Error(`Missing environment variable ${name}`)
}

function integer(env: Env, name: string, fallback: number): number {
  // missing → fallback; not a whole number → throw
}

export function loadConfig(env: Env = process.env): Config {
  return {
    port: integer(env, 'PORT', 3000),
    databaseUrl: required(env, 'DATABASE_URL'),
    // … one line per setting
  };
}
```

</details>

<details>
<summary><b>Code</b></summary>

```ts
// Reads every setting from environment variables once, at startup.

export interface ApnsConfig {
  keyP8: string;
  keyId: string;
  teamId: string;
  bundleId: string;
}

export interface Config {
  nodeEnv: string;
  port: number;
  logLevel: string;
  databaseUrl: string;
  databaseSslCaPath: string | undefined;
  pgPoolMax: number;
  awsRegion: string;
  s3Bucket: string;
  firebaseServiceAccountBase64: string | undefined;
  presignTtlSeconds: number;
  singlePutThresholdBytes: number;
  partSizeBytes: number;
  maxUploadBytes: number;
  maxRequestBytes: number;
  pullPageSizeMax: number;
  pushBatchMax: number;
  tombstoneRetentionDays: number;
  verifyMinDelayMs: number;
  verifyRateLimitPerMinute: number;
  uploadRateLimitPerMinute: number;
  maxSocketsPerUser: number;
  apns: ApnsConfig | undefined;
}

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function optional(env: Env, name: string): string | undefined {
  const value = env[name];
  if (value === undefined || value === '') {
    return undefined;
  }
  return value;
}

function integer(env: Env, name: string, fallback: number): number {
  const text = optional(env, name);
  if (text === undefined) {
    return fallback;
  }
  const value = Number(text);
  if (!Number.isInteger(value)) {
    throw new Error(`Environment variable ${name} must be a whole number, got "${text}"`);
  }
  return value;
}

function loadApns(env: Env): ApnsConfig | undefined {
  const keyBase64 = optional(env, 'APNS_KEY_P8_BASE64');
  if (keyBase64 === undefined) {
    return undefined;
  }
  return {
    keyP8: Buffer.from(keyBase64, 'base64').toString('utf8'),
    keyId: required(env, 'APNS_KEY_ID'),
    teamId: required(env, 'APNS_TEAM_ID'),
    bundleId: required(env, 'APNS_BUNDLE_ID'),
  };
}

export function loadConfig(env: Env = process.env): Config {
  return {
    nodeEnv: optional(env, 'NODE_ENV') ?? 'development',
    port: integer(env, 'PORT', 3000),
    logLevel: optional(env, 'LOG_LEVEL') ?? 'info',
    databaseUrl: required(env, 'DATABASE_URL'),
    databaseSslCaPath: optional(env, 'DATABASE_SSL_CA_PATH'),
    pgPoolMax: integer(env, 'PG_POOL_MAX', 10),
    awsRegion: required(env, 'AWS_REGION'),
    s3Bucket: required(env, 'S3_BUCKET'),
    firebaseServiceAccountBase64: optional(env, 'FIREBASE_SERVICE_ACCOUNT_BASE64'),
    presignTtlSeconds: integer(env, 'PRESIGN_TTL_SECONDS', 3600),
    singlePutThresholdBytes: integer(env, 'SINGLE_PUT_THRESHOLD_BYTES', 5 * 1024 * 1024),
    partSizeBytes: integer(env, 'PART_SIZE_BYTES', 8 * 1024 * 1024),
    maxUploadBytes: integer(env, 'MAX_UPLOAD_BYTES', 20 * 1024 * 1024 * 1024),
    maxRequestBytes: integer(env, 'MAX_REQUEST_BYTES', 1024 * 1024),
    pullPageSizeMax: integer(env, 'PULL_PAGE_SIZE_MAX', 500),
    pushBatchMax: integer(env, 'PUSH_BATCH_MAX', 200),
    tombstoneRetentionDays: integer(env, 'TOMBSTONE_RETENTION_DAYS', 90),
    verifyMinDelayMs: integer(env, 'VERIFY_MIN_DELAY_MS', 300),
    verifyRateLimitPerMinute: integer(env, 'VERIFY_RATE_LIMIT_PER_MINUTE', 30),
    uploadRateLimitPerMinute: integer(env, 'UPLOAD_RATE_LIMIT_PER_MINUTE', 600),
    maxSocketsPerUser: integer(env, 'MAX_SOCKETS_PER_USER', 5),
    apns: loadApns(env),
  };
}
```

</details>

<b>Try</b>

- In `.env` set `PORT=abc`; later (step 4) `npm run dev` stops with your message. Put it back.

</dd></dl>
</details>

<details open>
<summary><strong>3.2 Logger</strong></summary>
<dl><dd>

<b>File</b> · <b class="tag-new">New</b> · `src/logger.ts`

<b>Explain</b> · JSON logs, one line each, so CloudWatch can search them. `redact` replaces the token with `[Redacted]` if a request is ever logged with headers.

<details open>
<summary><b>Hint 2 · APIs</b></summary>

- `pino({ level, redact: [...] })`; Fastify accepts the same options object as `logger`.

</details>

<details>
<summary><b>Code</b></summary>

```ts
import { pino } from 'pino';

// One logger setup for the API (through Fastify) and the worker. Secrets never reach the logs.
export function loggerOptions(level: string) {
  return {
    level,
    redact: ['req.headers.authorization', 'req.headers.cookie'],
  };
}

export function createLogger(level: string) {
  return pino(loggerOptions(level));
}
```

</details>

</dd></dl>
</details>

<details open>
<summary><strong>3.3 Database</strong></summary>
<dl><dd>

<b>File</b> · <b class="tag-new">New</b> · `src/db.ts`

<b>Explain</b> · One pool of connections for the process, and `withTransaction` so a route never forgets `commit`, `rollback` or `release`.

<b>Think</b>

- Postgres `bigint` can be larger than a JavaScript number, so `pg` returns it as a string by default. Why is a number safe here? (Largest file: 20 GiB.)
- What happens to the pool if a route takes a connection and never releases it, 10 times?

<details open>
<summary><b>Hint 1 · Idea</b></summary>

- `pg.types.setTypeParser` for type 20 (bigint → number) and 1082 (date → plain string).
- Pool options include `options: '-c TimeZone=UTC'` and, on AWS, verified TLS from a CA file.
- `withTransaction`: connect → `begin` → work → `commit`; on error `rollback` and rethrow; always `release`.

</details>

<details open>
<summary><b>Hint 2 · APIs</b></summary>

- `new pg.Pool({ connectionString, max, ssl, options })`, `pool.connect()`, `client.query(sql, values)`, `client.release(destroy)`, `readFileSync(path, 'utf8')`.

</details>

<details open>
<summary><b>Hint 3 · Skeleton</b></summary>

```ts
export async function withTransaction<T>(
  pool: pg.Pool,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  try {
    // begin, result = await work(client), commit, return result
  } catch (error) {
    // try rollback; if rollback itself fails, broken = true
    throw error;
  } finally {
    // release; a broken connection is destroyed instead of reused
  }
}
```

</details>

<details>
<summary><b>Code</b></summary>

```ts
import { readFileSync } from 'node:fs';
import pg from 'pg';
import type { Config } from './config.js';

// bigint (type 20) comes back as a JS number: sizes and revs stay far below 2^53.
pg.types.setTypeParser(20, (text) => Number(text));
// date (type 1082) stays a plain "2026-11-05" string instead of a local-midnight Date.
pg.types.setTypeParser(1082, (text) => text);

// Shared by the pool and by the realtime hub's own LISTEN connection.
export function connectionOptions(config: Config): pg.ClientConfig {
  let ssl: pg.PoolConfig['ssl'] = undefined;
  if (config.databaseSslCaPath !== undefined) {
    // AWS RDS: verify the server certificate against the RDS CA bundle.
    const ca = readFileSync(config.databaseSslCaPath, 'utf8');
    ssl = { ca, rejectUnauthorized: true };
  }
  return {
    connectionString: config.databaseUrl,
    ssl,
    // Every timestamp is read and written in UTC.
    options: '-c TimeZone=UTC',
  };
}

export function createPool(config: Config): pg.Pool {
  const options = connectionOptions(config);
  return new pg.Pool({ ...options, max: config.pgPoolMax });
}

// Runs `work` inside one transaction: commit on success, rollback on any error.
export async function withTransaction<T>(
  pool: pg.Pool,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      // The connection itself failed: throw it away instead of returning it to the pool.
      broken = true;
    }
    throw error;
  } finally {
    client.release(broken);
  }
}
```

</details>

```bash
npm run typecheck
```

<b>Try</b>

- Remove the `finally` block and think: after how many failed requests does the API hang? (Pool size 10.) Put it back.

</dd></dl>
</details>

</dd></dl>

</dd></dl>

## 4. Error contract, app, health

<dl><dd>

#### Overview

<dl><dd>

- **Goal:** a running server: one error shape for every failure, `/health` that really checks the database.
- **Check:** `npm run dev`, then `curl -i localhost:3000/health` → `200 {"status":"ok"}`; `curl localhost:3000/nope` → `404` with the error shape.

| Action | File | Holds |
|---|---|---|
| <b class="tag-new">New</b> | `src/errors.ts` | `AppError` + helpers, the Fastify error and not-found handlers |
| <b class="tag-new">New</b> | `src/app.ts` | `AppDeps`, `buildApp(deps)`: Fastify with logger, body limit, routes |
| <b class="tag-new">New</b> | `src/routes/health.ts` | `GET /health`: `select 1`, `cache-control: no-store` |
| <b class="tag-new">New</b> | `src/main.ts` | Reads config, builds the app, listens, shuts down on `SIGTERM` |

```mermaid
sequenceDiagram
    participant C as curl
    participant F as Fastify
    participant H as health route
    participant PG as Postgres
    C->>F: GET /health
    F->>H: handler
    H->>PG: select 1
    PG-->>H: ok
    H-->>C: 200 {"status":"ok"}
    Note over F: a thrown AppError → error handler → { error: { code, message } }
```

</dd></dl>

#### Steps

<dl><dd>

<details open>
<summary><strong>4.1 Error contract</strong></summary>
<dl><dd>

<b>File</b> · <b class="tag-new">New</b> · `src/errors.ts`

<b>Explain</b> · Routes `throw badRequest(...)`, `notFound(...)` and so on; one handler turns any error into `{ error: { code, message } }` with the right status, and logs it. Unknown errors become `500` without details.

<b>Think</b>

- The iOS app aborts an upload on `400`. Name one temporary problem that must **not** answer `400`.
- Why should a `500` never include `error.message` from an unexpected exception?

<details open>
<summary><b>Hint 1 · Idea</b></summary>

- `class AppError extends Error` with `statusCode`, `code`, optional `extra` fields.
- Small factory functions: `badRequest`, `unauthorized`, `notFound`, `conflict`, `serviceUnavailable`.
- `registerErrorHandler(app)`: `AppError` → its status; Fastify validation error → `400 invalid_body`; body too large → `413`; rate limit → `429`; other 4xx → `400`; anything else → log + `500`.

</details>

<details open>
<summary><b>Hint 2 · APIs</b></summary>

- `app.setErrorHandler((error: FastifyError, request, reply) => …)`, `error.validation`, `error.code === 'FST_ERR_CTP_BODY_TOO_LARGE'`, `reply.status(n).send(body)`, `app.setNotFoundHandler`.

</details>

<details>
<summary><b>Code</b></summary>

```ts
import type { FastifyError, FastifyInstance } from 'fastify';

// The error contract: every error is { "error": { "code", "message" } }, never a stack trace.
// The iOS app aborts an upload on 400 and 404, so those are only for permanent problems.
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly extra: Record<string, unknown> | undefined;

  constructor(statusCode: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.extra = extra;
  }
}

export function badRequest(code: string, message: string): AppError {
  return new AppError(400, code, message);
}

export function unauthorized(code: string): AppError {
  return new AppError(401, code, 'Sign in again');
}

export function notFound(code: string, message: string): AppError {
  return new AppError(404, code, message);
}

export function conflict(code: string, message: string, extra?: Record<string, unknown>): AppError {
  return new AppError(409, code, message, extra);
}

export function serviceUnavailable(code: string): AppError {
  return new AppError(503, code, 'Try again later');
}

export function errorBody(code: string, message: string, extra?: Record<string, unknown>) {
  return { error: { code, message, ...extra } };
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      request.log.warn({ code: error.code, status: error.statusCode }, 'request failed');
      return reply.status(error.statusCode).send(errorBody(error.code, error.message, error.extra));
    }
    if (error.validation !== undefined) {
      request.log.warn({ validation: error.message }, 'invalid body');
      return reply.status(400).send(errorBody('invalid_body', error.message));
    }
    if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.status(413).send(errorBody('body_too_large', 'Request body is too large'));
    }
    if (error.statusCode === 429) {
      return reply.status(429).send(errorBody('rate_limited', 'Too many requests'));
    }
    if (error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
      // Malformed JSON, wrong content type and similar client mistakes.
      request.log.warn({ code: error.code }, 'bad request');
      return reply.status(400).send(errorBody('bad_request', error.message));
    }
    request.log.error({ err: error }, 'unexpected error');
    return reply.status(500).send(errorBody('internal', 'Something went wrong'));
  });

  app.setNotFoundHandler((request, reply) => {
    request.log.warn({ url: request.url }, 'route not found');
    return reply.status(404).send(errorBody('route_not_found', 'No such route'));
  });
}
```

</details>

<b>Try</b>

- After 4.4: `curl -X POST localhost:3000/health` → which handler answered, and with which code?

</dd></dl>
</details>

<details open>
<summary><strong>4.2 App</strong></summary>
<dl><dd>

<b>File</b> · <b class="tag-new">New</b> · `src/app.ts`

<b>Explain</b> · Builds the Fastify app from its dependencies. Tests call `buildApp` with test dependencies; `main.ts` calls it with real ones. Each feature adds its routes here.

<b>Think</b>

- Why is `trustProxy: true` needed once Caddy sits in front (F00c)? What would `request.ip` be without it?

<details open>
<summary><b>Hint 2 · APIs</b></summary>

- `Fastify({ logger, bodyLimit, trustProxy })`, then `registerErrorHandler(app)` and `healthRoutes(app, deps)`.

</details>

<details>
<summary><b>Code</b></summary>

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Config } from './config.js';
import { registerErrorHandler } from './errors.js';
import { loggerOptions } from './logger.js';
import { healthRoutes } from './routes/health.js';

// Everything a route needs, passed in so tests can swap real services for fakes.
export interface AppDeps {
  config: Config;
  pool: pg.Pool;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(deps.config.logLevel),
    bodyLimit: deps.config.maxRequestBytes,
    // Caddy sits in front: read the client IP from X-Forwarded-For.
    trustProxy: true,
  });

  registerErrorHandler(app);

  healthRoutes(app, deps);

  return app;
}
```

</details>

</dd></dl>
</details>

<details open>
<summary><strong>4.3 Health route</strong></summary>
<dl><dd>

<b>File</b> · <b class="tag-new">New</b> · `src/routes/health.ts`

<b>Explain</b> · Used by the deploy script, Docker, and uptime alarms. It answers `ok` only if the database answers.

<b>Think</b>

- The app reads its clock offset from the `Date` header of this response. What breaks if a CDN caches it for 5 minutes?

<details>
<summary><b>Code</b></summary>

```ts
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';

// Liveness for the load balancer, the deploy script and uptime alarms.
// The Date header doubles as the app's trusted clock, so nothing may cache this.
export function healthRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/health', async (request, reply) => {
    try {
      await deps.pool.query('select 1');
    } catch (error) {
      request.log.error({ err: error }, 'health: database unreachable');
      return reply.status(503).send({ status: 'database_unreachable' });
    }
    reply.header('cache-control', 'no-store');
    return { status: 'ok' };
  });
}
```

</details>

</dd></dl>
</details>

<details open>
<summary><strong>4.4 Main</strong></summary>
<dl><dd>

<b>File</b> · <b class="tag-new">New</b> · `src/main.ts`

<b>Explain</b> · The entry point: config → pool → app → listen on `0.0.0.0` (inside Docker, `localhost` would be unreachable). On `SIGTERM` (sent by `docker stop`) it finishes open requests, then closes the pool.

<details>
<summary><b>Code</b></summary>

```ts
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';

// Starts the HTTP server.
const config = loadConfig();

const pool = createPool(config);
const app = await buildApp({ config, pool });

await app.listen({ host: '0.0.0.0', port: config.port });

// docker stop sends SIGTERM: finish open requests, then close the database pool.
async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await pool.end();
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
```

</details>

```bash
npm run dev
```

```bash
curl -i localhost:3000/health
```

```bash
curl -s localhost:3000/nope
```

<b>Try</b>

- `docker compose stop postgres`, then curl `/health` → `503`. Start it again → `200`.
- Edit `health.ts` while `npm run dev` runs: `tsx watch` restarts by itself.

</dd></dl>
</details>

</dd></dl>

</dd></dl>

## 5. Migration runner

<dl><dd>

#### Overview

<dl><dd>

- **Goal:** `npm run migrate` applies every new `.sql` file in `migrations/` once, in name order.
- **Check:** `npm run migrate` logs `"applied":[]` (no files until F03) and creates `schema_migrations`.

| Action | File | Holds |
|---|---|---|
| <b class="tag-new">New</b> | `src/migrate.ts` | `runMigrations(pool, dir)`, plus a `main` for the command line |
| <b class="tag-new">New</b> | `migrations/.gitkeep` | Keeps the empty folder in git |

```mermaid
flowchart LR
    Lock["pg_advisory_lock"] --> Table["create schema_migrations<br/>if missing"]
    Table --> Done["read names already run"]
    Done --> Loop{"each .sql file,<br/>sorted"}
    Loop -->|"new"| Tx["begin · run file · insert name · commit"]
    Loop -->|"already run"| Skip["skip"]
    Tx -->|"error"| Stop["rollback, stop with the file name"]
```

</dd></dl>

#### Steps

<dl><dd>

<details open>
<summary><strong>5.1 Runner</strong></summary>
<dl><dd>

<b>File</b> · <b class="tag-new">New</b> · `src/migrate.ts`

<b>Explain</b> · Forward only: no "down" files. A file that ran is never edited; a fix is the next number. The advisory lock stops two deploys running the same file at once.

<b>Think</b>

- Why does each file run in its own transaction instead of all files in one?
- `0010_x.sql` and `0002_y.sql`: in which order does a plain text sort put them? Why do the names use four digits?

<details open>
<summary><b>Hint 1 · Idea</b></summary>

- Take one client, lock, create the table, read done names into a `Set`, loop over sorted `.sql` files, run the new ones.
- `main()` runs only when the file is started directly (`node dist/migrate.js`), not when a test imports it.

</details>

<details open>
<summary><b>Hint 2 · APIs</b></summary>

- `readdir`, `readFile` from `node:fs/promises`; `path.resolve`; `fileURLToPath(import.meta.url)`; `select pg_advisory_lock($1)`.

</details>

<details open>
<summary><b>Hint 3 · Skeleton</b></summary>

```ts
export async function runMigrations(pool: pg.Pool, dir: string = defaultMigrationsDir): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    // lock; create table if not exists schema_migrations (name text primary key, run_at timestamptz …)
    // doneNames = Set of names
    // files = readdir(dir) → keep .sql → sort
    for (const file of files) {
      // skip done; else begin, run, insert name, commit; on error rollback + throw with the file name
    }
  } finally {
    // unlock, release
  }
  return applied;
}
```

</details>

<details>
<summary><b>Code</b></summary>

```ts
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { createLogger } from './logger.js';

// Forward-only migrations: every file in migrations/ runs once, in file-name order,
// each in its own transaction. A file that already ran is never edited, only followed.

const here = path.dirname(fileURLToPath(import.meta.url));
export const defaultMigrationsDir = path.resolve(here, '..', 'migrations');

// Any number works; it only has to be the same for every process running migrations.
const MIGRATION_LOCK_ID = 7_241_001;

export async function runMigrations(
  pool: pg.Pool,
  dir: string = defaultMigrationsDir,
): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    // Two deploys at once must not run the same file twice.
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(
      `create table if not exists schema_migrations (
         name text primary key,
         run_at timestamptz not null default now()
       )`,
    );
    const done = await client.query<{ name: string }>('select name from schema_migrations');
    const doneNames = new Set(done.rows.map((row) => row.name));

    const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
    for (const file of files) {
      if (doneNames.has(file)) {
        continue;
      }
      const sql = await readFile(path.join(dir, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
        applied.push(file);
      } catch (error) {
        await client.query('rollback');
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
      }
    }
  } finally {
    await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
    client.release();
  }
  return applied;
}

// `npm run migrate` locally, `node dist/migrate.js` on the server.
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const pool = createPool(config);
  try {
    const applied = await runMigrations(pool);
    logger.info({ applied }, 'migrations done');
  } catch (error) {
    logger.error({ err: error }, 'migrations failed');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  await main();
}
```

</details>

```bash
mkdir -p migrations && touch migrations/.gitkeep
```

```bash
npm run migrate
```

<b>Try</b>

- Create `migrations/0001_try.sql` with `create table try_me (id int);`, run `npm run migrate` twice: the second run applies nothing. Then delete the file and `docker compose exec postgres psql -U sitelog -c 'drop table try_me; delete from schema_migrations'`.

</dd></dl>
</details>

</dd></dl>

</dd></dl>

## 6. Tests

<dl><dd>

#### Overview

<dl><dd>

- **Goal:** `npm test` runs against a fresh `sitelog_test` database every time.
- **Check:** `npm test` → 3 tests pass.

| Action | File | Holds |
|---|---|---|
| <b class="tag-new">New</b> | `vitest.config.ts` | Global setup, test files one after another (one shared database) |
| <b class="tag-new">New</b> | `test/global-setup.ts` | Drops and recreates `sitelog_test`, runs every migration |
| <b class="tag-new">New</b> | `test/helpers.ts` | `testConfig`, `createTestContext`, `closeTestContext` |
| <b class="tag-new">New</b> | `test/health.test.ts` | `/health` and the not-found shape |
| <b class="tag-new">New</b> | `test/migrate.test.ts` | Runs once, in order, stops on a broken file |

```mermaid
flowchart LR
    Run["npm test"] --> Setup["global-setup<br/>drop · create · migrate sitelog_test"]
    Setup --> Files["each *.test.ts"]
    Files --> Ctx["createTestContext()<br/>buildApp with test config"]
    Ctx --> Inject["app.inject(): a request<br/>without a real port"]
```

</dd></dl>

#### Steps

<dl><dd>

<details open>
<summary><strong>6.1 Test setup</strong></summary>
<dl><dd>

<b>File</b> · <b class="tag-new">New</b> · `vitest.config.ts`

<b>Explain</b> · One global setup before all tests; files run one by one because they share the test database.

<details>
<summary><b>Code</b></summary>

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['test/global-setup.ts'],
    // Test files share one database, so they run one after another.
    fileParallelism: false,
    testTimeout: 15000,
  },
});
```

</details>

---

<b>File</b> · <b class="tag-new">New</b> · `test/global-setup.ts`

<b>Explain</b> · Connects to the `postgres` admin database, drops `sitelog_test` (even if open connections remain: `with (force)`), creates it, migrates it.

<b>Think</b>

- Why a separate database instead of `sitelog`? What would `npm test` do to the data you made while trying the app?

<details>
<summary><b>Code</b></summary>

```ts
import pg from 'pg';
import { runMigrations } from '../src/migrate.js';

// Before all tests: a fresh, migrated sitelog_test database next to the dev database.
export const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://sitelog:sitelog@localhost:5432/sitelog_test';

export default async function setup(): Promise<void> {
  const url = new URL(testDatabaseUrl);
  const databaseName = url.pathname.slice(1);
  const adminUrl = new URL(testDatabaseUrl);
  adminUrl.pathname = '/postgres';

  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`drop database if exists ${databaseName} with (force)`);
  await admin.query(`create database ${databaseName}`);
  await admin.end();

  const pool = new pg.Pool({ connectionString: testDatabaseUrl });
  await runMigrations(pool);
  await pool.end();
}
```

</details>

---

<b>File</b> · <b class="tag-new">New</b> · `test/helpers.ts`

<b>Explain</b> · Builds the app the way `main.ts` does, but with test settings. F02 adds a fake Firebase and a mocked S3 here.

<details>
<summary><b>Code</b></summary>

```ts
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import { testDatabaseUrl } from './global-setup.js';

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    DATABASE_URL: testDatabaseUrl,
    AWS_REGION: 'ap-southeast-1',
    S3_BUCKET: 'sitelog-test',
    LOG_LEVEL: 'silent',
    VERIFY_MIN_DELAY_MS: '50',
    ...overrides,
  });
}

export interface TestContext {
  app: FastifyInstance;
  pool: pg.Pool;
  config: Config;
}

// An app on the test database. F02 adds fake Firebase and a mocked S3 here.
export async function createTestContext(
  overrides: Record<string, string> = {},
): Promise<TestContext> {
  const config = testConfig(overrides);
  const pool = new pg.Pool({ connectionString: config.databaseUrl, options: '-c TimeZone=UTC' });
  const app = await buildApp({ config, pool });
  await app.ready();
  return { app, pool, config };
}

export async function closeTestContext(context: TestContext): Promise<void> {
  await context.app.close();
  await context.pool.end();
}
```

</details>

</dd></dl>
</details>

<details open>
<summary><strong>6.2 First tests</strong></summary>
<dl><dd>

<b>File</b> · <b class="tag-new">New</b> · `test/health.test.ts`

<b>Explain</b> · `app.inject` sends a request straight into Fastify: no port, no network, fast.

<details>
<summary><b>Code</b></summary>

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeTestContext, createTestContext, type TestContext } from './helpers.js';

describe('health and error contract', () => {
  let context: TestContext;
  beforeAll(async () => {
    context = await createTestContext();
  });
  afterAll(async () => {
    await closeTestContext(context);
  });

  it('answers ok when the database is reachable', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('answers unknown routes with the error shape', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'route_not_found', message: 'No such route' },
    });
  });
});
```

</details>

---

<b>File</b> · <b class="tag-new">New</b> · `test/migrate.test.ts`

<b>Explain</b> · Uses a temporary folder of tiny `.sql` files, so it tests the runner without touching real migrations.

<details>
<summary><b>Code</b></summary>

```ts
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/migrate.js';
import { testDatabaseUrl } from './global-setup.js';

describe('runMigrations', () => {
  let pool: pg.Pool;
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: testDatabaseUrl });
  });
  afterAll(async () => {
    await pool.query('drop table if exists migrate_test_a, migrate_test_b');
    await pool.query(`delete from schema_migrations where name like 'test_%'`);
    await pool.end();
  });

  it('runs each file once, in order, and stops at a broken one', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'migrations-'));
    await writeFile(path.join(dir, 'test_0001_a.sql'), 'create table migrate_test_a (id int);');
    await writeFile(path.join(dir, 'test_0002_b.sql'), 'create table migrate_test_b (id int);');

    expect(await runMigrations(pool, dir)).toEqual(['test_0001_a.sql', 'test_0002_b.sql']);
    expect(await runMigrations(pool, dir)).toEqual([]);

    await writeFile(path.join(dir, 'test_0003_broken.sql'), 'create tabel oops;');
    await expect(runMigrations(pool, dir)).rejects.toThrow('test_0003_broken.sql');
    const done = await pool.query(
      `select name from schema_migrations where name = 'test_0003_broken.sql'`,
    );
    expect(done.rows).toHaveLength(0);
  });
});
```

</details>

```bash
npm test
```

<b>Try</b>

- Change the expected status in `health.test.ts` to `201`: read how vitest shows the difference. Undo.

</dd></dl>
</details>

</dd></dl>

</dd></dl>

## 7. Docker image

<dl><dd>

#### Overview

<dl><dd>

- **Goal:** one image that runs the API, the worker (F15) and migrations, on any server.
- **Check:** `docker build -t sitelog-api .` succeeds; `docker run --rm sitelog-api ls dist` lists `main.js`.

| Action | File | Holds |
|---|---|---|
| <b class="tag-new">New</b> | `Dockerfile` | Build stage (compile) + run stage (production packages, `dist/`, `migrations/`, `deploy/`, RDS certificates), runs as user `node` |
| <b class="tag-new">New</b> | `.dockerignore` | Keeps `node_modules`, `.env`, docs and tests out of the image |

```mermaid
flowchart LR
    Ctx["repo"] --> Build["stage 1: npm ci, tsc"]
    Build -->|"dist/"| Run["stage 2: npm ci --omit=dev<br/>+ dist, migrations, deploy, certs"]
    Run --> Img["image sitelog-api"]
```

</dd></dl>

#### Steps

<dl><dd>

<details open>
<summary><strong>7.1 Dockerfile</strong></summary>
<dl><dd>

<b>File</b> · <b class="tag-new">New</b> · `Dockerfile`

<b>Explain</b> · Two stages keep compilers and test tools out of the final image. `deploy/` is copied in too: the server reads its Compose file from the image (F00c).

<b>Think</b>

- Why copy `package.json` and `package-lock.json` and run `npm ci` **before** copying `src/`? (Think about what Docker caches when only one `.ts` file changed.)

<details>
<summary><b>Code</b></summary>

```dockerfile
# Build stage: compile TypeScript.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Run stage: only production dependencies and the compiled code.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
# Server files: sitelog-deploy copies them out of the image on every deploy.
COPY deploy ./deploy
# Amazon RDS certificate bundle, so the database connection is verified (DATABASE_SSL_CA_PATH).
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/certs/rds-global-bundle.pem
RUN chmod 644 /app/certs/rds-global-bundle.pem
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

</details>

---

<b>File</b> · <b class="tag-new">New</b> · `.dockerignore`

<details>
<summary><b>Code</b></summary>

```text
node_modules
dist
.env
.git
docs
infra
test
```

</details>

- `deploy/` arrives in F00c: until then create it empty so the `COPY` works:

```bash
mkdir -p deploy && touch deploy/.gitkeep
```

```bash
docker build -t sitelog-api .
```

<b>Try</b>

- `docker run --rm sitelog-api whoami` → `node`, not `root`. Why does that matter if someone breaks into the API?

</dd></dl>
</details>

</dd></dl>

</dd></dl>

## 8. CI

<dl><dd>

#### Overview

<dl><dd>

- **Goal:** every pull request and push to `main` checks format, lint, types, tests, build and the CDK app.
- **Check:** open a PR: the `CI` workflow is green.

| Action | File | Holds |
|---|---|---|
| <b class="tag-new">New</b> | `.github/workflows/ci.yml` | Job `api` with a Postgres service; job `infra` (typecheck + `cdk synth`, from F00c) |

```mermaid
flowchart LR
    PR["pull request"] --> API["api job<br/>format · lint · typecheck · test · build"]
    PR --> Infra["infra job<br/>typecheck · cdk synth"]
    API --> Green["merge allowed"]
    Infra --> Green
```

</dd></dl>

#### Steps

<dl><dd>

<details open>
<summary><strong>8.1 Workflow</strong></summary>
<dl><dd>

<b>File</b> · <b class="tag-new">New</b> · `.github/workflows/ci.yml`

<b>Explain</b> · GitHub starts a Postgres container next to the job, so tests run exactly as on your Mac. The `infra` job needs `infra/`: it passes once F00c step 1 is done.

<b>Think</b>

- The test URL in CI uses `localhost:5432`. Why does that work, although Postgres runs in another container?

<details>
<summary><b>Code</b></summary>

```yaml
# Every pull request and every push to main: format, lint, types, tests, build, CDK synth.
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  api:
    runs-on: ubuntu-24.04
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: sitelog
          POSTGRES_PASSWORD: sitelog
          POSTGRES_DB: sitelog
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U sitelog"
          --health-interval 2s
          --health-retries 15
    env:
      TEST_DATABASE_URL: postgres://sitelog:sitelog@localhost:5432/sitelog_test
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run format:check
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build

  infra:
    runs-on: ubuntu-24.04
    defaults:
      run:
        working-directory: infra
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: infra/package-lock.json
      - run: npm ci
      - run: npm run typecheck
      - run: npm run synth
```

</details>

```bash
npm run format && npm run lint && npm run typecheck && npm test
```

```bash
git checkout -b feature/f00-skeleton && git add . && git commit -m "feat: api - skeleton with health, migrations, tests" && git push -u origin feature/f00-skeleton
```

- Open the PR on GitHub; CI's `infra` job fails until F00c adds `infra/` — merge after F00c, or remove the `infra` job until then.
- GitHub → repo **Settings** → **Branches** → add a rule for `main`: require the `api` and `infra` checks.

</dd></dl>
</details>

</dd></dl>

</dd></dl>

## Feature done

<dl><dd>

- [ ] `curl localhost:3000/health` → `{"status":"ok"}`; `/nope` → the error shape
- [ ] `npm run migrate` creates `schema_migrations`
- [ ] `npm test` → 3 passed
- [ ] `docker build .` succeeds
- [ ] CI runs on the PR

</dd></dl>
