# n8n on Vercel (free)

Run your own [n8n](https://n8n.io) automation server for **$0**, on Vercel's free plan,
with a free Neon database and your own domain for webhooks and forms.

> Community experiment. Not affiliated with n8n or Vercel. Best for personal, low-traffic use.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/muhammad-zulqarnain-awan/n8n-on-vercel&env=N8N_ENCRYPTION_KEY,N8N_PUBLIC_URL&envDescription=See%20the%20README%20for%20how%20to%20set%20these)

(You still create the Neon database yourself, see step 4.)

---

## What is this?

n8n normally needs a server that is always on. Vercel only runs short-lived functions.
This project bridges the gap:

1. Every request to your domain goes to one Vercel function.
2. The function starts n8n if it is not running, waits until it is ready, and passes the request on.
3. When nobody has used it for 4 minutes, n8n shuts itself down. This lets the free database
   sleep and keeps you inside Vercel's free limits.
4. All your workflows, credentials and history live in a Neon Postgres database, so nothing is lost when n8n stops.

## What works

- The n8n editor, login and workflows
- Native **Schedule Trigger**, **Cron**, and **Interval** nodes (executed by the built-in scheduler engine)
- Webhooks and **forms** on your own domain
- Credentials (stored encrypted), the Code node (JavaScript), HTTP Request, and more
- Your data survives restarts and redeploys

## What does not work (read this first)

| Limitation | Why |
|---|---|
| **Sub-minute real-time polling** | High-frequency polling (e.g. checking Gmail every 30 seconds) requires a 24/7 server. |
| First request after idle is slow (cold start, roughly 10 to 60 seconds) | n8n has to boot. |
| Requests larger than about 4.5 MB fail | Vercel's limit. |
| A single run can last at most 300 seconds | Vercel Hobby's limit. |
| No community nodes, no Python Code node | They cannot be stored on Vercel's temporary disk. |

If you need sub-minute polling or continuous background WebSockets, use a normal persistent server instead.

## Before you start

You need free accounts at:
- [GitHub](https://github.com)
- [Vercel](https://vercel.com) (Hobby plan)
- A domain name you control (optional but needed for a custom webhook URL)

You also need Node.js 24 only if you want to test on your own computer.

## Setup

### 1. Create your secret key (once)

```bash
openssl rand -hex 32
```

Save it in a password manager. **If you lose or change it, your saved n8n credentials can never be read again.**

### 2. Get the code

Click **Use this template** or **Fork** on this repo (or use the Deploy button above).

### 3. Import into Vercel

- Vercel dashboard > **Add New > Project** > pick your copy of the repo.
- Framework Preset: **Other**. Leave build settings as they are.
- After import: **Settings > General > Node.js Version = 24.x**.

### 4. Create the free database

- In your Vercel project open the **Storage** tab > **Create Database** > **Neon** > choose the **Free** plan.
- Connect it to your project (Production). Vercel adds the database variables for you.

### 5. Add two environment variables

Vercel project > **Settings > Environment Variables** (Production):

| Name | Value |
|---|---|
| `N8N_ENCRYPTION_KEY` | the key from step 1 |
| `N8N_PUBLIC_URL` | your address, for example `https://n8n.yourdomain.com` (no slash at the end) |

Optional:
- `ENGINE_SECRET` (or `CRON_SECRET`): Random secret token to secure `/api/engine`. Set this if you use GitHub Actions for hourly scheduling.
- `STATUS_TOKEN`: Any random text to turn on a private diagnostic page at `/__status`.

### 6. Add your domain

**Settings > Domains > Add**, then create the DNS record Vercel shows you.
Wait until it says the configuration is valid.

Also check **Settings > Deployment Protection**: Production must not require a Vercel login,
or outside services cannot reach your webhooks.

### 7. Deploy and create your account

Redeploy (Deployments > Redeploy), then open your address. The very first load sets up the
database and can take up to a minute.

**Create your owner account immediately.** Until you do, anyone who finds the URL could claim it.

### 8. Check that everything works

```bash
./scripts/smoke.sh https://n8n.yourdomain.com
```

All lines should say `200`. To also test a webhook, add its path:
`./scripts/smoke.sh https://n8n.yourdomain.com my-webhook-path`

### 9. (Optional) Set up GitHub Actions for hourly / sub-daily schedules

By default, Vercel triggers daily scheduled workflows natively at midnight UTC.

If you have workflows that need to run **hourly or every 30 minutes**, configure the built-in GitHub Action:

1. In your GitHub repository, open **Settings > Secrets and variables > Actions**.
2. Add the following repository secrets:

| Secret Name | Required? | Example Value | Description |
|---|---|---|---|
| `N8N_PUBLIC_URL` | **Yes** | `https://n8n.yourdomain.com` | Your n8n public URL (no trailing slash). |
| `ENGINE_SECRET` | Optional | `openssl rand -hex 16` | Matches the `ENGINE_SECRET` set in Vercel to protect `/api/engine`. |

3. **Verify it works**: Go to GitHub **Actions** tab > select **n8n Native Scheduler Engine** > click **Run workflow**.

## Staying inside the free limits

- Vercel Hobby: 4 CPU-hours and 360 GB-hours per month. Neon Free: 100 compute-hours and 0.5 GB storage.
- In local tests a cold start used about 9.5 CPU-seconds. That allows several hundred "sessions" a month.
  Check your real numbers in Vercel > Usage and the Neon console after a week.
- Close the n8n editor tab when you are done. An open editor keeps n8n awake.
- Old executions are deleted automatically (after 72 hours or 1000 runs).

## Troubleshooting

| What you see | What to do |
|---|---|
| 503 "n8n is starting or unavailable" | Wait a few seconds and retry. If it stays, read Vercel > Logs. |
| 404 on a webhook you just published | Wait a few seconds and retry. Make sure the workflow is published. |
| "Mismatching encryption keys" in logs | `N8N_ENCRYPTION_KEY` is different from the one first used. |
| Database errors | Neon may be waking up (retry), or the free monthly compute is used up. |
| Wrong host in webhook URLs | `N8N_PUBLIC_URL` is missing or wrong. |
| Deployment fails because of size | n8n is large and needs Vercel's Large Functions. See Vercel's docs. |

## Updating n8n

The n8n version is pinned in `package.json` on purpose. To upgrade, change the version, run
`npm install`, test locally, then push. n8n has announced that some features this project relies on
(internal task runner mode, running outside Docker) will be removed in future versions, so read the
release notes first.

## Backups

Neon Free only keeps 6 hours of history. Download your important workflows now and then
(workflow menu > Download).

## Test on your computer (optional)

```bash
export N8N_ENCRYPTION_KEY=$(openssl rand -hex 32)
export N8N_PUBLIC_URL=http://localhost:3000
export DATABASE_URL=postgres://user:password@localhost:5432/n8n
npm ci
node scripts/dev.js
```

## Contributing

Ideas, bug reports and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License and disclaimer

The code in this repository is MIT licensed (see `LICENSE`).
n8n itself is **not** MIT: it is installed from npm during the build and is covered by
[n8n's own license](https://github.com/n8n-io/n8n/blob/master/LICENSE.md). Read it before commercial use.
Vercel's Hobby plan is limited to personal, non-commercial use.
This project is provided as is, with no warranty.