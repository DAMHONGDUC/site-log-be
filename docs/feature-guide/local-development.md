# Local development

<dl><dd>

- Run the whole backend on your Mac — Postgres, S3 and the API — so the iOS and Android apps can be built against it before staging exists.
- S3 is local ([RustFS](https://github.com/rustfs/rustfs), S3-compatible); Firebase Auth and Cloud Messaging are the real `sitelog-dev` project.
- Testing one feature end to end on iOS: [local testing with iOS](local-testing-with-ios.md).

</dd></dl>

## Contents

<dl><dd>

1. [What runs where](#1-what-runs-where)
2. [Once per Mac](#2-once-per-mac)
3. [Start the backend](#3-start-the-backend)
4. [Point the apps at your Mac](#4-point-the-apps-at-your-mac)
5. [Check it works](#5-check-it-works)
6. [Memory while building Android](#6-memory-while-building-android)
7. [Reset](#7-reset)
8. [Troubleshooting](#8-troubleshooting)

</dd></dl>

## 1. What runs where

<dl><dd>

| Part | Where | Port | Memory |
|---|---|---|---|
| Postgres 16 | Docker (`docker-compose.yml`, service `postgres`) | 5432 | ~100 MB |
| S3 (RustFS `1.0.6`) | Docker (service `s3`), limited to 512 MB | 9000 API · 9001 console | ~20–300 MB |
| API | `npm run dev` on the Mac | 3000 | ~150 MB |
| Worker | `npm run worker:dev` on the Mac | — | ~100 MB |
| Firebase Auth · Cloud Messaging | Real `sitelog-dev` project | — | — |

- Why RustFS: MinIO stopped publishing free Docker images in October 2025; RustFS is S3-compatible, its own image is pinned to a version, and it answers on the same ports.
- Single PUT, presigned GET, multipart (8 MiB parts), copy and delete were checked against it with the backend's `Storage` class.

</dd></dl>

## 2. Once per Mac

<dl><dd>

| Step | Command or place |
|---|---|
| Docker with Compose (Colima) | `brew install colima docker docker-compose`, then `colima start --memory 2 --cpu 2` |
| Compose plugin found by Docker | `mkdir -p ~/.docker/cli-plugins && ln -sfn "$(brew --prefix)/opt/docker-compose/bin/docker-compose" ~/.docker/cli-plugins/docker-compose` |
| Node 24 | `nvm use` (reads `.nvmrc`) |
| `.env` | `cp .env.example .env`; the S3 lines already point at RustFS |
| Firebase key | `sitelog-dev` → Project settings → Service accounts → Generate new private key; `base64 -i key.json` into `FIREBASE_SERVICE_ACCOUNT_BASE64` |

- 2 GB for Colima is enough: Postgres and RustFS together stay under 1 GB, and the rest of the RAM goes to Android Studio and the emulator.

</dd></dl>

## 3. Start the backend

<dl><dd>

```bash
docker compose up -d
```

```bash
npm ci && npm run migrate && npm run s3:bucket
```

```bash
npm run dev
```

- In a second terminal:

```bash
npm run worker:dev
```

- After your first sign-in from an app, make that account the Admin (uid: Firebase console → Authentication). Until then every call answers `403`, because nobody is a member yet:

```bash
npm run seed:admin -- <email> <firebase-uid>
```

| Check | Command | Expect |
|---|---|---|
| API | `curl localhost:3000/health` | `{"status":"ok"}` |
| API explorer | `http://localhost:3000/docs` | Every endpoint, from `docs/openapi.json` |
| S3 console | `http://localhost:9001` (`sitelog` / `sitelog-secret`) | Bucket `sitelog-dev` |

</dd></dl>

## 4. Point the apps at your Mac

<dl><dd>

| | iOS simulator | Android emulator | Real phone (same Wi-Fi) |
|---|---|---|---|
| API base URL | `http://localhost:3000` | `http://localhost:3000` after `adb reverse` | `http://<Mac LAN IP>:3000` |
| Uploads (presigned URLs) | Work as signed (`localhost:9000`) | Work after `adb reverse` | Set `S3_ENDPOINT=http://<Mac LAN IP>:9000`, restart the API |
| Plain HTTP | Debug build allows `localhost` in ATS | Debug build: `cleartextTrafficPermitted` for `localhost` | Same, for the LAN IP |
| Firebase | Debug build uses the `sitelog-dev` config file | Same | Same |

- Android emulator, each time it starts:

```bash
adb reverse tcp:3000 tcp:3000 && adb reverse tcp:9000 tcp:9000
```

- Do not use `10.0.2.2` for uploads: a presigned URL's signature covers its host, so a URL signed for `localhost:9000` fails with `SignatureDoesNotMatch` when sent anywhere else.
- Mac LAN IP: `ipconfig getifaddr en0`.

</dd></dl>

## 5. Check it works

<dl><dd>

| Flow | Do in the app | See |
|---|---|---|
| Sign in | Sign in with the `sitelog-dev` account | `GET /me` answers `403` before `seed:admin`, then `200` with the Admin |
| Sync | Create a project | `sync push` in the API log; the row in `projects` |
| Single upload | Take a photo | `upload begun` `mode: single`, `upload completed`; the file in the console at `:9001` |
| Multipart upload | Record a video over 5 MB | `mode: multipart`, parts signed, `upload completed` |
| Verify | Wait for the worker | Worker log `upload verified`; `verify_state = verified` |
| Push | Upload a session | `push sent` in the API log; the notification on a real phone |

</dd></dl>

## 6. Memory while building Android

<dl><dd>

| Change | Saves | How |
|---|---|---|
| Colima at 2 GB, not 4 GB | ~2 GB | `colima stop && colima start --memory 2 --cpu 2` |
| Gradle heap | 1–2 GB | `org.gradle.jvmargs=-Xmx2g` in `gradle.properties` |
| Emulator RAM | ~1 GB | Device Manager → Edit → RAM 2048 MB (keep a Google Play image to receive pushes) |
| One simulator at a time | 1–2 GB | Quit the iOS Simulator while on Android |

- With these, the backend, Android Studio and one emulator fit in about 10–12 GB of a 16 GB Mac.

</dd></dl>

## 7. Reset

<dl><dd>

| Reset | Command |
|---|---|
| Database and files (everything) | `docker compose down -v && docker compose up -d && npm run migrate && npm run s3:bucket` |
| Only the files | S3 console → bucket `sitelog-dev` → delete objects |
| Stop for the day | `docker compose stop` (data stays) |

</dd></dl>

## 8. Troubleshooting

<dl><dd>

| Symptom | Cause | Fix |
|---|---|---|
| `docker: unknown command: docker compose` | Compose plugin not linked | §2, the `cli-plugins` line |
| `InvalidLocationConstraint` or `SignatureDoesNotMatch` on every call | `AWS_REGION` differs from `RUSTFS_REGION` in `docker-compose.yml` | Keep both `ap-southeast-1` |
| `NoSuchBucket` | Bucket not created after a reset | `npm run s3:bucket` |
| Upload from the Android emulator times out | No `adb reverse` for 9000 | §4 |
| `S3_ENDPOINT is for local development only` at start | `NODE_ENV=production` with a local endpoint | Unset `S3_ENDPOINT` outside your Mac |
| Every call `403` after sign-in | The account is not a member | `npm run seed:admin -- <email> <uid>`, or invite it from the Admin |
| `Missing environment variable FIREBASE_SERVICE_ACCOUNT_BASE64` | `.env` key empty | §2, Firebase key |

</dd></dl>
