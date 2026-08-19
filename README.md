# QRForge

**QR codes, as an API.** QRForge is a QR-code generation REST API with a built-in SaaS billing layer — register an API key, generate PNG/SVG QR codes with one HTTP request, and pay a flat monthly fee for higher quotas.

It's both a **product** (host it and sell QR generation) and a **template** (self-host it under the MIT license and run your own instance).

```
curl -G "https://your-qrf-domain/api/v1/qr" \
  -H "X-API-Key: qrf_live_…" \
  --data-urlencode "data=https://qrforge.dev" \
  --data "size=512&format=png" \
  -o code.png
```

## Why this product (research summary)

- **Proven, boring demand.** QR codes are embedded in restaurant menus, payment terminals, event tickets, and print. "QR code generator" is a constantly searched phrase; the free endpoints that serve it (goqr.me, QRServer) are **unauthenticated, rate-limited, with no SLA, no analytics, and no support**.
- **The paid market is thin and overpriced.** As of mid-2026, hosted QR *APIs* cost $9.99/mo for just 5,000 codes (RapidAPI-hosted), and "dynamic QR" platforms charge $5–$250/mo for features most developers don't need. A flat **$9/mo for 10,000 static codes** undercuts every comparable API.
- **Low-cost, low-support = passive.** Static QR generation is stateless CPU work. One $5 VPS (or a free-tier container host) runs thousands of codes per day. No user data, no email deliverability, no support tickets — just an API key, a quota counter, and Stripe doing the billing.
- **Micro-SaaS economics.** Solo-founder products that do one narrow thing well (Carrd, Bannerbear, SimpleAnalytics) routinely reach $25K–$100K MRR on exactly this model: free tier → cheap monthly plan → near-zero churn because the cost of switching out is a one-liner of code.

## Features

- **One-request QR generation** — PNG or SVG, up to 2000px, custom colors (8-hex with alpha / `transparent`), error-correction levels L/M/Q/H, adjustable quiet zone.
- **No-signup live demo** on the landing page (strictly IP rate-limited) for instant conversion.
- **Free tier forever** (200 codes/mo) for lead generation.
- **Pro $9/mo** (10,000/mo) and **Business $29/mo** (100,000/mo) — flat, monthly, cancel anytime.
- **Stripe Checkout + Billing Portal + webhooks** wired end-to-end: subscription starts, plan upgrades, downgrades on cancel, and `past_due` marking all happen automatically.
- **Usage analytics** — per-key monthly counters, `X-Ratelimit-*` response headers, dashboard with progress bar.
- **Abuse protection** — per-IP rate limits on all endpoints, input validation, Stripe webhook signature verification.
- **Self-hostable** — SQLite (zero external services), MIT license.

## Quickstart

```bash
git clone https://github.com/Lanakali/qrforge
cd qrforge
npm install
npm start            # → http://localhost:3000
npm test             # smoke test suite (ephemeral port, temp DB)
```

The app runs with **zero configuration** in free-tier-only mode: keys work, quotas apply, and billing endpoints return a clear 503 until Stripe is configured.

### Configuration (`.env` or environment)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port. |
| `APP_URL` | `http://localhost:PORT` | Public base URL — used in Stripe return URLs and doc links. **Set this in production.** |
| `DATABASE_PATH` | `./data/qrforge.db` | SQLite file location. |
| `STRIPE_SECRET_KEY` | *(empty)* | Stripe secret key (test or live). Empty = billing disabled. |
| `STRIPE_WEBHOOK_SECRET` | *(empty)* | `whsec_…` for webhook signature verification. |
| `STRIPE_PRICE_PRO_ID` | *(empty)* | Stripe Price ID for the $9/mo Pro plan. |
| `STRIPE_PRICE_BUSINESS_ID` | *(empty)* | Stripe Price ID for the $29/mo Business plan. |
| `ALLOW_UNVERIFIED_WEBHOOKS` | `0` | `1` accepts webhooks without a signature — **local dev only, never in production.** |

## API reference

Base URL: `https://your-qrf-domain/api/v1`

### `POST /api/v1/register` — create a free API key

```bash
curl -X POST https://your-qrf-domain/api/v1/register \
  -H "Content-Type: application/json" \
  -d '{"name": "my-project"}'
```
→ `201` `{"apiKey":"qrf_live_…","plan":"free","monthlyLimit":200}`

### `GET /api/v1/qr` — generate a QR code

Auth: `X-API-Key` header (or `key` query param for `<img src>` use).

| Param | Required | Default | Description |
|---|---|---|---|
| `data` | yes | — | Text/URL to encode (≤ 2000 chars). |
| `size` | no | `300` | Pixel dimension, 1–2000. |
| `format` | no | `png` | `png` or `svg`. |
| `ec` | no | `M` | Error correction: `L` `M` `Q` `H`. |
| `dark` | no | `#000000` | Foreground hex color. |
| `light` | no | `#ffffff` | Background hex color (8-digit hex for alpha). |
| `transparent` | no | `0` | `1` = transparent PNG background. |
| `margin` | no | `2` | Quiet-zone modules, 0–10. |

`POST /api/v1/qr` accepts the same parameters as a JSON body.

Successful responses include:
```
X-Ratelimit-Limit: 200
X-Ratelimit-Remaining: 187
X-Ratelimit-Period: month
```

### `GET /api/v1/usage` — plan & quota

```json
{"plan":"pro","planName":"Pro","monthlyLimit":10000,"used":1284,
 "remaining":8716,"period":"2026-08","resetsOnUtc":"2026-09-01T00:00:00.000Z"}
```

### `GET /api/v1/health` — liveness

### Errors

| Status | Code | Meaning |
|---|---|---|
| 400 | `bad_request` | Missing/invalid parameter. |
| 401 | `unauthorized` | Missing/invalid API key. |
| 429 | `rate_limited` / `monthly_limit_reached` | Slow down / upgrade. |
| 500 | `internal_error` | Server fault. |

Rate limits (per IP): QR generation 120/min, registration 5/hour, demo 20/min + 100/day.

## Billing setup (Stripe)

1. Create a [Stripe account](https://dashboard.stripe.com) (test mode is fine for local dev).
2. In **Products & prices**, create two recurring prices:
   - **QRForge Pro** — $9.00/mo → copy the Price ID into `STRIPE_PRICE_PRO_ID`
   - **QRForge Business** — $29.00/mo → copy the Price ID into `STRIPE_PRICE_BUSINESS_ID`
3. Set `STRIPE_SECRET_KEY` (and `APP_URL`).
4. **Webhook:** point `https://your-qrf-domain/stripe/webhook` at
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, then copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

   **Local development** with the [Stripe CLI](https://stripe.com/docs/stripe-cli):
   ```bash
   stripe listen --forward-to localhost:3000/stripe/webhook
   # copy the printed whsec_… into STRIPE_WEBHOOK_SECRET
   ```
   (Without the CLI you can set `ALLOW_UNVERIFIED_WEBHOOKS=1` to test the webhook path.)

The webhook layer maps price ID → plan, upgrades the key's plan on `active`/`trialing`, reverts to Free on cancel, and flags `past_due` when a card fails. Customers manage/cancel themselves in the Stripe Billing Portal (`/api/billing/portal`).

## Deployment

The project ships in two halves by design:

| Half | Hosts | Cost |
|---|---|---|
| **Website** (landing, docs, dashboard, client-side QR demo) | **GitHub Pages** — free, automatic via CI | $0 |
| **API** (keys, quotas, QR generation, Stripe billing/webhooks) | any Node 18+ host (Render free tier, Railway, or a $5 VPS) | $0–5/mo |

The static site is **built as fully self-contained HTML** — `npm run build`
inlines all CSS, JS, the QR engine, and the site config into each page
(`public/`, gitignored). One file per page, **zero external requests**: it
works on GitHub Pages, opened straight from disk, or in any single-file
viewer. The demo QR generator runs 100% client-side, so the site is fully
functional even before the API is deployed ("demo mode").

### 1. Website → GitHub Pages (automatic)

A GitHub Actions workflow (`.github/workflows/pages.yml`) already:
1. runs `npm ci && npm run build && npm test` (build + the API smoke suite) on every push to `main`, and
2. deploys the built `public/` to GitHub Pages on success.

One-time setup in the repo: **Settings → Pages → Build and deployment → Source: "GitHub Actions"**.
The site then lives at `https://<github-username>.github.io/qrforge/` and updates on every push.

### 2. API → a small Node host

**Render (one-click):** open the repo in Render → *New → Web Service* from the repo.
The included [`.render.yaml`](.render.yaml) configures build/start/health check
(`/api/v1/health`). Set the `sync: false` env vars: `APP_URL`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_ID`, `STRIPE_PRICE_BUSINESS_ID`.
⚠️ Render's free tier has an **ephemeral filesystem** — attach a persistent disk
for `DATABASE_PATH=/opt/render/data/qrforge.db`, or use the VPS option below for
durable state.

**Railway:** `railway up` in the repo root (uses [`railway.json`](railway.json));
attach a volume for `DATABASE_PATH`.

**$5 VPS (durable, cheapest at scale):**
```bash
# install Node 20, then
git clone https://github.com/Lanakali/qrforge /opt/qrforge && cd /opt/qrforge
npm ci --omit=dev
# write .env (PORT=3000, APP_URL=https://qr.example.com, Stripe keys, DATABASE_PATH=/opt/qrforge/data/qrforge.db)
pm2 start server.js --name qrforge && pm2 save
```
Put Caddy/Nginx in front for TLS:
```
qr.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

### 3. Wire them together (one line)

Once the API has a URL, set it in [`site.config.json`](site.config.json):

```json
{ "apiBase": "https://qr.example.com" }
```

and push — CI rebuilds the site with the config embedded, and the dashboard,
upgrade flow, and docs point at the live API. Until then the site runs in
demo mode with the client-side generator. (Locally: `npm run build` after
editing the config.)

The Stripe **webhook** endpoint lives on the **API** host:
`https://<api-host>/stripe/webhook` (events + setup in §Billing setup).

## Production checklist

**Before taking payments:**
- [ ] API deployed behind HTTPS (Render/Railway/VPS) with `APP_URL` set to the real URL
- [ ] `STRIPE_SECRET_KEY` in **live mode** (sk-live_…) and price IDs for live prices
- [ ] Stripe webhook pointing at `https://<api-host>/stripe/webhook` with `STRIPE_WEBHOOK_SECRET` set — **never** run `ALLOW_UNVERIFIED_WEBHOOKS=1` in production
- [ ] `public/config.js` → `apiBase` set to the API URL and pushed
- [ ] Test the full loop in Stripe test mode first: register key → checkout → webhook flips plan → dashboard shows new plan → cancel reverts to free

**Ongoing ops (≈15 min/week):**
- [ ] Uptime monitor on `https://<api-host>/api/v1/health` + the Pages URL (free tiers of any monitor work)
- [ ] Nightly backup of `data/qrforge.db*` (the only state on the API host)
- [ ] Stripe dashboard: watch failed payments (dunning is automatic; `past_due` is flagged in the DB)
- [ ] GitHub Actions: confirm each push ran tests + deployed (red = site not updated)

**Security posture (already in code):** webhook signature verification, per-IP rate limits, 100 KB body cap, strict input validation, `X-Content-Type-Options`, `X-Frame-Options: DENY`, CSP, HSTS when `APP_URL` is HTTPS, `no-store` on quota-bearing responses, static codes only (the API never stores encoded payloads).

## How this makes money (playbook)

**Unit economics:** hosting ≈ $5–7/mo, Stripe ≈ 2.9% + 30¢ per charge, COGS of generating a QR ≈ 0. A single Pro customer covers the whole server. At 50 Pro subs ≈ $450 MRR on ~$10/mo costs.

**Growth channels (in order of effort:**
1. **SEO pages** — "free QR code API", "QRServer alternative", "QR code generator with API key": target the exact searches that already go to the free endpoints. The instant in-browser demo converts visitors who hit those endpoints' rate limits (and the site itself is free to host on GitHub Pages).
2. **API marketplaces** — list on RapidAPI (they run the billing; you keep ~80–90%) and the GetStream/npms API directories.
3. **Launch posts** — Show HN, Product Hunt, dev.to ("I built the boring QR API I couldn't find").
4. **Content** — short dev tutorials that use the API (event tickets, WiFi QR, vCards) with working code; each post is a long-tail SEO asset.
5. **Self-host as funnel** — the MIT source means teams can audit or self-host; commercial traffic (anything with real volume) lands on the hosted tiers.

**Ops that keep it passive:** uptime monitor (free tier of any host) → one alert channel; nightly DB backup; Stripe handles dunning; quotas are enforced in code, so support ≈ zero.

## Security notes

- Stripe webhooks are signature-verified when `STRIPE_WEBHOOK_SECRET` is set (required in production).
- API keys are 192-bit random, stored in plaintext in SQLite (they're bearer secrets; rotate by creating a new key — the old one can be deleted by DB admin).
- Input validation on every parameter; body limit 100 KB; per-IP rate limiting; strict CSP on all pages; `X-Content-Type-Options: nosniff`.
- Static QR codes store no user data: the service logs per-key counts, not the encoded payloads.

## Development

```bash
npm run dev    # node --watch
npm test       # smoke tests: health, register, PNG/SVG, auth, validation, quota, demo, pages
```

Architecture: `server.js` (Express app) → `lib/db.js` (SQLite schema), `lib/keys.js` (keys + quotas), `lib/billing.js` (Stripe checkout/webhooks), `lib/rateLimit.js` (fixed-window limiter). Static site: `site/` holds the templates (vanilla JS landing page + dashboard), `build.js` inlines CSS/JS/config into self-contained pages in `public/` (gitignored; `site.config.json` flips the site between demo mode and a hosted API; `site/js/vendor/qrcode.min.js` is a pinned IIFE build of the `qrcode` package — regenerate with `npm run build:vendor` after bumping the dependency). `npm start`/`npm test` build automatically via pre-hooks.

## License

MIT — see [LICENSE](LICENSE).
