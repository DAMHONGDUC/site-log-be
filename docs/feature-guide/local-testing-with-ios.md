# Local testing with iOS

<dl><dd>

- Run the backend on your Mac and point the SiteLog app at it, on the simulator or a real iPhone, to test a feature end to end before it reaches staging.
- Works from S1 on; each sprint's scenarios are in [§6](#6-scenarios).

</dd></dl>

## Contents

<dl><dd>

1. [What runs where](#1-what-runs-where)
2. [Start the backend](#2-start-the-backend)
3. [Point the app at your Mac](#3-point-the-app-at-your-mac)
4. [Sign in](#4-sign-in)
5. [Watch what happens](#5-watch-what-happens)
6. [Scenarios](#6-scenarios)
7. [Reset](#7-reset)
8. [Troubleshooting](#8-troubleshooting)

</dd></dl>

## 1. What runs where

<dl><dd>

```mermaid
flowchart LR
    subgraph Mac["Your Mac"]
        Sim["iOS Simulator<br/>Debug build"]
        API["npm run dev<br/>:3000"]
        Worker["npm run worker:dev<br/>(F15+)"]
        PG[("Docker Postgres<br/>sitelog")]
    end
    Phone["iPhone<br/>Debug build"] -->|"http://&lt;mac&gt;.local:3000"| API
    Sim -->|"http://localhost:3000"| API
    API --> PG
    Worker --> PG
    API -->|"verify token"| FB["Firebase sitelog-dev"]
    Sim -->|"PUT / GET presigned"| S3[("S3 sitelog-dev bucket")]
    Phone -->|"PUT / GET presigned"| S3
    Worker --> S3
```

| Piece | Local | Why not fake it |
|---|---|---|
| API, worker, Postgres | Your Mac | Fast restart, your logs, your data |
| Firebase Auth | Real `sitelog-dev` project | The app's sign-in is real Firebase; the backend checks the same tokens |
| S3 | Real dev bucket (`SiteLog-Dev`) | Presigned URLs, ETags and multipart behave exactly as on AWS; costs cents |
| APNs (F16) | Apple sandbox, real iPhone only | The simulator cannot receive remote pushes from APNs |

</dd></dl>

## 2. Start the backend

<dl><dd>

```bash
cd ~/Documents/GitHub/BE/site-log-be && docker compose up -d
```

```bash
aws sso login --profile sitelog
```

```bash
npm run migrate && npm run dev
```

- From F15 on, in a second terminal:

```bash
npm run worker:dev
```

- Check from the Mac and from the simulator's Safari:

```bash
curl localhost:3000/health
```

| `.env` line | Value for local testing |
|---|---|
| `DATABASE_URL` | `postgres://sitelog:sitelog@localhost:5432/sitelog` |
| `AWS_PROFILE` · `AWS_REGION` · `S3_BUCKET` | `sitelog` · `ap-southeast-1` · `sitelog-dev-<account>` |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | the `sitelog-dev` key (F00a §3) |
| `APNS_*` | only for push tests (F16 §1) |

</dd></dl>

## 3. Point the app at your Mac

<dl><dd>

- The app reads its backend URL from the build configuration (iOS `project.yml`, iOS F00). For a local run, set the Debug value and allow plain HTTP to local hosts **in Debug only**.

| Target | Base URL | ATS |
|---|---|---|
| Simulator | `http://localhost:3000` | `NSAllowsLocalNetworking = YES` (Debug Info.plist) |
| iPhone on the same Wi-Fi | `http://<mac-name>.local:3000` (System Settings → General → Sharing → Local hostname) | same key; iOS asks for **Local Network** permission once: allow |
| iPhone anywhere | an HTTPS tunnel, e.g. `cloudflared tunnel --url http://localhost:3000` → `https://….trycloudflare.com` | nothing to change |
| Staging | `https://api-staging.<domain>` | nothing to change |

- In iOS `project.yml` the Debug value is a build setting (not an `.xcconfig`, where `//` starts a comment and cuts `http://`). Run `xcodegen` after changing it.
- The WebSocket URL is the same host with `ws://` (local) or `wss://` (tunnel, staging).
- The iPhone also needs `NSLocalNetworkUsageDescription` in the Debug Info.plist for `.local` hosts.

</dd></dl>

## 4. Sign in

<dl><dd>

- In the app: **Sign in** with `test1@example.com` (the Firebase test user). The backend log shows the first signed-in request with `uid`.
- For curl next to the app, the same user:

```bash
TOKEN=$(npm run -s token -- test1@example.com '<password>')
```

- Two simulators as "two devices": Xcode → **Window** → **Devices and Simulators** → add a second iPhone simulator, run the app on both, sign in with the same user.

</dd></dl>

## 5. Watch what happens

<dl><dd>

| Want to see | Run |
|---|---|
| Readable API logs | `npm run dev \| npx pino-pretty` |
| Rows the app pushed | `docker compose exec postgres psql -U sitelog -c 'select id, name, rev, client_updated_at, deleted_at from projects order by rev'` |
| Revisions per user | `docker compose exec postgres psql -U sitelog -c 'select * from sync_state'` |
| Upload jobs | `docker compose exec postgres psql -U sitelog -c 'select id, object_key, mode, state, verify_state, verification_code from uploads order by created_at desc limit 10'` |
| Files in the bucket | `aws s3 ls s3://sitelog-dev-<account>/<uid>/ --recursive` |
| Unfinished multipart uploads | `aws s3api list-multipart-uploads --bucket sitelog-dev-<account>` |
| The WebSocket by hand | `npx wscat@6 -c ws://localhost:3000/ws` |
| What the app sends | Xcode console (the app's `AppLogger` lines), or Proxyman/Charles on the simulator |

</dd></dl>

## 6. Scenarios

<dl><dd>

| Sprint | Scenario | Expect on the backend |
|---|---|---|
| S1 | Sign in; any call with the token removed | `401 missing_token` in the log |
| S1 | Delete account from the app | `account deleted` log line; the user gone in Firebase |
| S2 | Create a project offline on simulator A, go online | `sync push` with `pushed: 1`; simulator B pulls it within one sync interval |
| S2 | Rename on A offline, rename on B online, then A online | A gets `superseded` and shows B's name |
| S2 | Delete on A | B's pull returns the tombstone; the project disappears on B |
| S3 | Take a photo | `upload begun` `mode: single`, then `upload completed`; the file in `aws s3 ls`; code in the app |
| S3 | Open the photo on B | `media urls signed` |
| S4 | Record a 1-minute video, kill the app at 40 %, wait 1 h, relaunch | `upload parts refreshed`, then `upload completed`; no part uploaded twice in `list-multipart-uploads` before completion |
| S4 | Airplane mode mid-upload | No error lines; the app waits and resumes |
| S6 | Export a PDF, open `http://localhost:3000/verify/<code>` in the simulator's Safari | `verify lookup` `found: true` |
| S8 | Upload with the app open | Two `jobCompleted` on the socket; the photo turns "verified" |
| S8 | Real iPhone, app closed, finish a session | `push sent` `outcome: sent`; the notification opens the session |

</dd></dl>

## 7. Reset

<dl><dd>

| Reset | Command |
|---|---|
| Local database (everything) | `docker compose down -v && docker compose up -d && npm run migrate` |
| One user's data and Firebase user | the app's **Delete account**, or `curl -X DELETE localhost:3000/account -H "Authorization: Bearer $TOKEN"` |
| Dev bucket | `aws s3 rm s3://sitelog-dev-<account> --recursive` |
| The app | delete it from the simulator (local store, Keychain stay until then) |

- After a database reset, devices still hold old cursors: delete and reinstall the app (or sign out and in), or the pull starts from a `rev` the new database never had.

</dd></dl>

## 8. Troubleshooting

<dl><dd>

| Symptom | Cause | Fix |
|---|---|---|
| App: "The resource could not be loaded because the App Transport Security policy…" | Plain HTTP without the Debug ATS key | `NSAllowsLocalNetworking = YES` in Debug |
| iPhone cannot reach `<mac>.local:3000` | Different Wi-Fi, Local Network permission denied, macOS firewall | Same network; Settings → Privacy → Local Network → SiteLog on; allow `node` in the firewall prompt |
| Every call `401 invalid_token` | App and backend use different Firebase projects | Both `sitelog-dev`: compare `project_id` in the service-account JSON with the app's `GoogleService-Info.plist` |
| `503 auth_unavailable` | The Mac cannot reach Google | Network; VPN |
| PUT to S3 `403 SignatureDoesNotMatch` | The app's `Content-Type` differs from `contentType` it sent to begin | Send the same value |
| PUT to S3 `403 Request has expired` | URL older than 1 hour, or the simulator clock is wrong | The app refreshes (multipart) or begins again (single) |
| Backend: `Could not load credentials from any providers` | SSO session expired | `aws sso login --profile sitelog`, restart `npm run dev` |
| Pull returns nothing after a database reset | Old cursor | Reinstall the app (see [§7](#7-reset)) |
| WebSocket closes `4001` right away | Token expired or another Firebase project | Refresh the token; check the project |
| Port 3000 in use | Another `npm run dev` | `lsof -i :3000`, stop it |

</dd></dl>
