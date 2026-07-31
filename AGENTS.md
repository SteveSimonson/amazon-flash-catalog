# AGENTS.md — Amazon Flash Catalog

## Product

Multi-site **Amazon flash catalog** control plane:

- Admin UI (GitHub OAuth, org allowlist)
- Per-site source categories + filters
- Fetch: BSR/search discovery + optional Creators enrichment
- Publish: Cloudflare **R2** + `GET /api/catalog/:siteId`
- Schedule: manual + optional cron

Live pattern consumers: e.g. iBamboo limited-time shelves.

## Git / PR workflow

Follow Steve’s standing **pr-ship-gate**:

1. Feature branch (not direct `main` for non-trivial work)
2. PR with summary + test plan
3. CI green (`npm run typecheck`)
4. Independent code review → merge (squash)

Never commit secrets (`.dev.vars`, OAuth secrets, Creators credentials).

## Build

```bash
npm ci
npm run typecheck
```

Deploy: `npm run deploy` (requires wrangler auth + R2 bucket + secrets).

## Security focus

- Session cookie: HttpOnly, signed HMAC, org check on every admin route
- Catalog GET is public by design (product JSON only — no secrets)
- Do not log access tokens or credential secrets

## Review focus

1. AuthZ (org gate) on all mutating APIs
2. No secrets in repo or client JS
3. Soft-fail Creators path must not block publish
4. R2 keys stable: `catalogs/{siteId}/latest.json`, `config/app.json`
