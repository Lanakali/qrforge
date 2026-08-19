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

Any Node 18+ host works — one process, one SQLite file, no other services.

**Railway / Render / Fly.io (fastest):**
- Build: `npm install` · Start: `npm start`
- Set the env vars above, add a persistent disk for `DATABASE_PATH` (Railary/Render disks; on Render use a volume for `/data`).

**$5 VPS (cheapest at scale):**
```bash
# install Node 20, then
git clone https://github.com/Lanakali/qrforge /opt/qrforge && cd /opt/qrforge
npm install --omit=dev
# write .env (PORT=3000, APP_URL=https://qr.example.com, Stripe keys, DATABASE_PATH=/opt/qrforge/data/qrforge.db)
pm2 start server.js --name qrforge && pm2 save
```
Put Caddy/Nginx in front for TLS:
```
qr.example.com {
    reverse_proxy 127.0.0.1:3000
}
```
Back up `data/qrforge.db*` nightly (it's the only state).

## How this makes money (playbook)

**Unit economics:** hosting ≈ $5–7/mo, Stripe ≈ 2.9% + 30¢ per charge, COGS of generating a QR ≈ 0. A single Pro customer covers the whole server. At 50 Pro subs ≈ $450 MRR on ~$10/mo costs.

**Growth channels (in order of effort:**
1. **SEO pages** — "free QR code API", "QRServer alternative", "QR code generator with API key": target the exact searches that already go to the free endpoints. The no-signup demo converts visitors who hit those endpoints' rate limits.
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

Architecture: `server.js` (Express app) → `lib/db.js` (SQLite schema), `lib/keys.js` (keys + quotas), `lib/billing.js` (Stripe checkout/webhooks), `lib/rateLimit.js` (fixed-window limiter) → `public/` (vanilla JS landing page + dashboard, no build step).

## License

MIT — see [LICENSE](LICENSE).
