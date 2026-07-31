# Amazon Flash Catalog

**Multi-site Amazon flash catalog refresher** — admin UI to pick categories & filters, discover products (BSR / search + optional Creators API enrichment), publish JSON to **Cloudflare R2**, and refresh on a **manual or optional cron** schedule.

Public repo: [github.com/SteveSimonson/amazon-flash-catalog](https://github.com/SteveSimonson/amazon-flash-catalog)

## Product decisions (v1)

| Decision | Choice |
|----------|--------|
| Fetch method | **Mix**: BSR/search discovery + Creators API enrichment when eligible |
| Shape | Standalone **public** app (not inside a storefront) |
| Auth | **GitHub OAuth**, members of a configured **GitHub org** |
| Catalog transport | **Cloudflare R2** (`catalogs/{siteId}/latest.json`) + HTTP GET |
| Host | **Cloudflare Workers** |
| Schedule | **Run now** + optional per-site cron (`manual` / hourly / 6h / daily / weekly) |
| Amazon account | **One shared** Associate tag + optional Creators credentials |
| Admin control | Full: Amazon source categories + map to site shelves + filters |

## Architecture

```
┌─────────────────┐     GitHub OAuth      ┌──────────────────┐
│  Admin browser  │ ───────────────────►  │  Worker (admin)  │
└─────────────────┘                       │  + cron trigger  │
                                          └────────┬─────────┘
                                                   │
                    BSR/search ──► filter ──► enrich (Creators, soft-fail)
                                                   │
                                                   ▼
                                          ┌──────────────────┐
                                          │  R2 bucket       │
                                          │  catalogs/...    │
                                          │  config/app.json │
                                          └────────┬─────────┘
                                                   │
                     GET /api/catalog/:siteId  ◄───┘
                                                   │
                                          ┌────────▼─────────┐
                                          │  iBamboo / other │
                                          │  storefronts     │
                                          └──────────────────┘
```

## Quick start

### 1. Install & typecheck

```bash
npm install
npm run typecheck
```

### 2. Cloudflare setup

```bash
npx wrangler login
npx wrangler r2 bucket create amazon-flash-catalogs
```

Edit `wrangler.jsonc`:

- `vars.ALLOWED_GITHUB_ORG` — org slug (e.g. `my-company`)
- `vars.APP_BASE_URL` — public worker URL after first deploy
- `vars.AMAZON_ASSOCIATE_TAG` — shared tag

Secrets:

```bash
openssl rand -hex 32 | npx wrangler secret put SESSION_SECRET
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
# optional enrichment:
npx wrangler secret put AMAZON_CREATORS_CREDENTIAL_ID
npx wrangler secret put AMAZON_CREATORS_CREDENTIAL_SECRET
```

### 3. GitHub OAuth App

Create at [GitHub Developer Settings → OAuth Apps](https://github.com/settings/developers):

- **Homepage URL**: your `APP_BASE_URL`
- **Callback URL**: `{APP_BASE_URL}/auth/callback`
- Scopes used: `read:user`, `read:org`

### 4. Local dev

```bash
cp .env.example .dev.vars
# fill secrets
npm run dev
```

Open `http://127.0.0.1:8787` — note OAuth callback must match a tunnel or localhost config if testing login locally.

### 5. Deploy

```bash
npm run deploy
```

## Admin usage

1. Sign in with GitHub (must be in `ALLOWED_GITHUB_ORG`).
2. **Add site** (slug + name), e.g. `ibamboo`.
3. **Add source categories**: browse node and/or search query, map to site shelf.
4. Set **filters**: top N, min rating/reviews, price band, include/exclude keywords.
5. Choose **schedule** (`manual` or cron preset).
6. **Run refresh now** — writes R2 + updates site status.

## Consumer sites

Pull the latest flash catalog:

```http
GET https://<worker-host>/api/catalog/<siteId>
```

CORS: `Access-Control-Allow-Origin: *` on catalog GET.

Example shape:

```json
{
  "siteId": "ibamboo",
  "generatedAt": "2026-07-30T12:00:00.000Z",
  "weekOf": "2026-07-28",
  "productCount": 42,
  "associateTag": "iu0e3-20",
  "products": [
    {
      "asin": "B0…",
      "title": "…",
      "url": "https://www.amazon.com/dp/…?tag=…",
      "siteCategory": "kitchen",
      "limitedTime": true,
      "enriched": false
    }
  ],
  "categoryStats": []
}
```

Sites can also read the same object from R2 if they share the bucket binding.

## API (authenticated)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Public health |
| GET | `/api/catalog/:siteId` | Public latest catalog |
| GET | `/api/sites` | List config |
| POST | `/api/sites` | Create site |
| PUT | `/api/sites/:id` | Update site meta/schedule |
| PUT | `/api/sites/:id/categories` | Replace category list |
| POST | `/api/sites/:id/refresh` | Run refresh now |
| DELETE | `/api/sites/:id` | Delete site config |

## Cron

Worker trigger: `0 * * * *` (hourly). Each site with a non-`manual` schedule is run only when due based on `lastRunAt`.

## Limits & honesty

- Amazon **HTML discovery is best-effort** and can break when Amazon changes markup.
- **Creators API** may return `AssociateNotEligible` until the Associates account meets sales requirements; enrichment is soft-fail (discovery still publishes).
- Respect Amazon’s terms, rate limits, and Associates program policies.
- Admin UI is **noindex**; this is an internal control plane, not a marketing site.

## Roadmap ideas

- [ ] Wire iBamboo shop to pull `/api/catalog/ibamboo` into limited-time shelves
- [ ] Per-site Associate tags (if multi-account needed later)
- [ ] Dry-run preview before publish
- [ ] Diff view vs previous run
- [ ] Stronger parse for ratings/prices from search HTML when API unavailable

## License

MIT — see [LICENSE](./LICENSE).
