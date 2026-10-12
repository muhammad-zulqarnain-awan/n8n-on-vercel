# Contributing

Thanks for helping! This project is small on purpose: a proxy function (`api/index.js`),
a process supervisor (`lib/supervisor.js`) and a config builder (`lib/config.js`).

## Good first contributions
- Deploy it and report what you saw (cold start time, Vercel usage, errors). Real numbers help most.
- Test and document behavior we have not verified on Vercel: frozen and resumed instances,
  "respond immediately" webhooks, Large Functions limits.
- Reduce CPU used by an idle n8n process, or reduce boot time.
- Improve the docs, especially for other DNS providers.

## Before opening a pull request
1. Use Node 24 and a local Postgres (any version).
2. Run `node scripts/dev.js` with the env vars from the README.
3. Run `./scripts/smoke.sh http://localhost:3000 <webhook-path>`; every line must be 200.
4. If you change n8n settings in `lib/config.js`, say why and which n8n version you tested.
5. Keep changes small and explain the reason in the PR description.

## Reporting bugs
Include: n8n version, Node version, Vercel plan, relevant Vercel runtime log lines, and what you expected.
**Never paste your `N8N_ENCRYPTION_KEY`, database URL or credentials.**

## Security issues
Do not open a public issue. Use GitHub's "Report a vulnerability" button on the Security tab.

## Be kind
Be respectful and constructive. Newcomers are welcome.