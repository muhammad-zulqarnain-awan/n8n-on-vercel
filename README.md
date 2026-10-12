# n8n on Vercel (Hobby) + Neon (Free)

Self-hosted n8n 2.42.6 running as a Vercel Function, with a persistent Neon Postgres
database and your own domain for the editor, webhooks and forms. Everything stays on free tiers.

## How it works

`vercel.json` routes every URL to `api/index.js`. That function starts n8n as a child process
on `127.0.0.1:5678`, waits until it reports ready, and proxies the request to it. After
`N8N_IDLE_SHUTDOWN_SECONDS` (default 240) without traffic the process is stopped, which
closes all database connections so Neon can autosuspend (it suspends after 5 idle minutes)
and spares your Vercel Hobby CPU and memory allowance. The next request starts n8n again.

## Deploy

### 1. Generate the encryption key (once, keep it forever)
```bash
openssl rand -hex 32
```
Store it in a password manager. **If it is lost or changed, every saved credential becomes unreadable.**

### 2. Push this folder to a GitHub repository
```bash
git init && git add . && git commit -m "n8n on vercel"
git branch -M main && git remote add origin <your-repo-url> && git push -u origin main
```
(`package-lock.json` must be committed; the build uses `npm ci`.)

### 3. Import into Vercel
- Add New > Project > import the repo. Framework Preset: **Other**. Leave build settings alone.
- Settings > General > Node.js Version: **24.x**.
- Settings > Functions: keep the region close to your Neon region (e.g. both in US East).

### 4. Create the database (Storage tab)
- Storage > Create Database > **Neon** > **Free plan**.
- Connect it to this project for **Production** (and Preview if you use it).
- This injects `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_URL`... automatically.
  The app prefers `DATABASE_URL_UNPOOLED` (direct connection).

### 5. Environment variables (Settings > Environment Variables, Production)
| Name | Value |
|---|---|
| `N8N_ENCRYPTION_KEY` | the key from step 1 |
| `N8N_PUBLIC_URL` | `https://your-domain` (no trailing slash) |
| `STATUS_TOKEN` | optional; any random string; enables `GET /__status` |

### 6. Add your domain
Settings > Domains > Add. Create the DNS record Vercel shows (use the exact value in the dashboard).
Wait until it shows "Valid Configuration" and HTTPS works.

### 7. Check Deployment Protection
Settings > Deployment Protection: make sure **Production** is not behind Vercel Authentication,
or external webhook callers will be blocked.

### 8. Deploy, then secure the instance immediately
The first request runs database migrations and can take 30-60 seconds. Open
`https://your-domain` and **create the owner account right away**: the setup page is public
until an owner exists.

### 9. Verify
```bash
./scripts/smoke.sh https://your-domain            # health + editor
./scripts/smoke.sh https://your-domain my-path    # plus a production webhook
```

## Local test (optional)
```bash
export N8N_ENCRYPTION_KEY=$(openssl rand -hex 32)
export N8N_PUBLIC_URL=http://localhost:3000
export DATABASE_URL=postgres://user:pass@localhost:5432/n8n
npm ci && node scripts/dev.js     # Node 24 required
```

## Free-tier budget (measured locally; confirm on your Usage page)
- Cold boot: about 9.5 CPU-seconds and 9-10 s wall time locally. Vercel will be slower or faster; measure it.
- Idle n8n uses about 1.1 CPU-seconds per 30 s while running.
- Vercel Hobby includes 4 CPU-hours and 360 GB-hours per month, as hard caps.
- Neon Free includes 100 CU-hours and 0.5 GB per project; compute suspends at the monthly limit.
- Rough capacity: several hundred cold-start sessions per month. Low-volume webhooks and forms fit; constant traffic does not.

## What works / what does not on Hobby
Works: editor, login, workflows, manual runs, production webhooks, form triggers, credentials,
Code node (JS), HTTP Request, nested webhook calls, persistence across restarts.

Limited or unavailable:
- **Schedule/Cron and polling triggers** need an always-running process. They only run while an instance happens to be awake. Hobby cron is at most daily.
- **Request bodies above ~4.5 MB** are rejected by Vercel.
- **Max runtime 300 s** per request/execution.
- **Cold starts**: the first request after idle waits for n8n to boot.
- **Community nodes** are disabled (they install to `/tmp`, which is wiped).
- **Python Code node** is unavailable; JavaScript works.
- Keep the editor tab closed when not in use: its live connection keeps n8n awake.

## Operations
- **Usage**: Vercel dashboard > Usage (Active CPU, Provisioned Memory); Neon console > Monitoring (CU-hours, storage).
- **Storage**: execution history is pruned (72 h / 1000 executions). Tune with `EXECUTIONS_DATA_MAX_AGE` and `EXECUTIONS_DATA_PRUNE_MAX_COUNT`.
- **Upgrading n8n**: change the pinned version in `package.json`, run `npm install`, test locally against a copy of your database, then push. n8n has announced that internal task-runner mode and non-container installs will be removed in future releases, so read the release notes before each upgrade.
- **Backups**: Neon Free keeps only a 6-hour restore window. Export important workflows regularly (Editor > workflow menu > Download).

## Troubleshooting
| Symptom | Likely cause |
|---|---|
| 503 "n8n is starting or unavailable" | cold start still in progress or boot failed; check Vercel runtime logs |
| 404 on a fresh webhook | workflow not published yet, or activation still finishing; retry after a few seconds |
| "Mismatching encryption keys" in logs | `N8N_ENCRYPTION_KEY` differs from the one that created the data |
| Database connection errors | Neon compute waking up (retry), or free CU-hours exhausted |
| Function size / deployment error | Large Functions beta not enabled for the project; see Vercel docs |
| Webhook URLs show the wrong host | `N8N_PUBLIC_URL` unset or wrong |
