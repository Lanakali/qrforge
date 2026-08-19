'use strict';

const path = require('path');
const express = require('express');
const QRCode = require('qrcode');

const keys = require('./lib/keys');
const { rateLimit } = require('./lib/rateLimit');
const billing = require('./lib/billing');

const { PLANS, findKey, usageFor, recordUsage, currentMonth, createKey } = keys;

const app = express();
app.disable('x-powered-by');
// Behind a reverse proxy (nginx/Caddy/Render/Railway) take the first
// X-Forwarded-For hop as the client address for rate limiting.
app.set('trust proxy', 1);

const PORT = Number(process.env.PORT || 3000);
const APP_URL = (process.env.APP_URL || '').replace(/\/+$/, '');
const PUBLIC_URL = APP_URL || 'http://localhost:' + PORT;
const IS_HTTPS = /^https:/.test(APP_URL);

// ---------------------------------------------------------------------------
// Security headers + body parsing
// ---------------------------------------------------------------------------

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (IS_HTTPS) res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'"
  );
  next();
});

// Stripe webhooks need the raw body for signature verification — register
// BEFORE the JSON parser so express.json() doesn't consume it first.
app.post(
  '/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const result = await billing.handleWebhook(req.body, req.headers['stripe-signature']);
    res.status(result.status || 200).json(result.ok ? { received: true } : { error: result.error });
  }
);

app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ipOf = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

const HEX_COLOR = /^#?([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/;

function parseColor(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const s = String(value).trim();
  if (HEX_COLOR.test(s)) return s.startsWith('#') ? s : '#' + s;
  return null;
}

function readKey(req) {
  const h = req.headers['x-api-key'];
  return String(h || req.query.key || (req.body && req.body.key) || '').trim();
}

function sendError(res, err, statusOverride) {
  const status = err.status || statusOverride || 500;
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({
    error: {
      code: status === 400 ? 'bad_request' : status === 401 ? 'unauthorized' : 'internal_error',
      message: err.message || 'Something went wrong.',
    },
  });
}

/**
 * Validate parameters and render a QR code buffer/string.
 * Throws Error with .status for expected client errors.
 */
async function renderQr(p) {
  const data = String(p.data ?? '');
  if (!data) {
    const e = new Error("Missing required parameter: 'data' (the text or URL to encode).");
    e.status = 400;
    throw e;
  }
  if (data.length > 2000) {
    const e = new Error("'data' must be 2000 characters or fewer.");
    e.status = 400;
    throw e;
  }

  const format = String(p.format || 'png').toLowerCase();
  if (!['png', 'svg'].includes(format)) {
    const e = new Error("'format' must be 'png' or 'svg'.");
    e.status = 400;
    throw e;
  }

  const sizeRaw = parseInt(p.size, 10);
  const size = Number.isFinite(sizeRaw) ? Math.min(2000, Math.max(1, sizeRaw)) : 300;

  const ec = String(p.ec || 'M').toUpperCase();
  if (!['L', 'M', 'Q', 'H'].includes(ec)) {
    const e = new Error("'ec' must be one of: L, M, Q, H.");
    e.status = 400;
    throw e;
  }

  const marginRaw = parseInt(p.margin, 10);
  const margin = Number.isFinite(marginRaw) ? Math.min(10, Math.max(0, marginRaw)) : 2;

  const transparent = ['1', 'true', 'yes'].includes(String(p.transparent || '').toLowerCase());
  const dark = parseColor(p.dark, '#000000');
  if (dark === null) {
    const e = new Error("'dark' must be a hex color like #1a2b3c.");
    e.status = 400;
    throw e;
  }
  const light = parseColor(p.light, transparent ? '#ffffff00' : '#ffffff');
  if (light === null) {
    const e = new Error("'light' must be a hex color like #ffffff.");
    e.status = 400;
    throw e;
  }

  const opts = {
    errorCorrectionLevel: ec,
    margin,
    width: size,
    color: { dark, light },
  };
  return format === 'svg' ? QRCode.toString(data, { ...opts, type: 'svg' }) : QRCode.toBuffer(data, { ...opts, type: 'png' });
}

function contentTypeFor(req) {
  const format = String(
    req.method === 'GET' ? req.query.format || 'png' : (req.body && req.body.format) || req.query.format || 'png'
  ).toLowerCase();
  return format === 'svg' ? 'image/svg+xml' : 'image/png';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', service: 'qrforge', version: require('./package.json').version });
});

/** No-signup demo endpoint (strictly rate limited by IP). */
app.get(
  '/api/v1/demo-qr',
  rateLimit({ limit: 20, windowMs: 60_000, keyFn: (r) => 'demo:min:' + ipOf(r) }),
  rateLimit({ limit: 100, windowMs: 86_400_000, keyFn: (r) => 'demo:day:' + ipOf(r) }),
  async (req, res) => {
    try {
      const out = await renderQr(req.query);
      res.setHeader('Content-Type', contentTypeFor(req));
      // Deterministic output → safe for CDN caching (no secrets in the URL).
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('X-Ratelimit-Period', 'demo');
      res.send(out);
    } catch (err) {
      sendError(res, err);
    }
  }
);

/** Register: mint a free API key. */
app.post(
  '/api/v1/register',
  rateLimit({ limit: 5, windowMs: 3_600_000, keyFn: ipOf }),
  (req, res) => {
    try {
      const name = String((req.body && req.body.name) || 'default');
      const key = createKey(name);
      res.status(201).json({
        apiKey: key.apiKey,
        plan: 'free',
        monthlyLimit: PLANS.free.monthlyLimit,
        docs: PUBLIC_URL + '/#docs',
        dashboard: PUBLIC_URL + '/dashboard.html',
      });
    } catch (err) {
      sendError(res, err);
    }
  }
);

/** Requires a valid API key and monthly-quota headroom. */
function requireKey(req, res, next) {
  const keyRow = findKey(readKey(req));
  if (!keyRow) {
    res.status(401).json({
      error: {
        code: 'unauthorized',
        message: "Missing or invalid API key. Get a free key with: POST /api/v1/register",
      },
    });
    return;
  }
  const limit = PLANS[keyRow.plan].monthlyLimit;
  const used = usageFor(keyRow);
  if (used >= limit) {
    res.status(429).json({
      error: {
        code: 'monthly_limit_reached',
        message: `Monthly limit of ${limit} QR codes reached for the '${keyRow.plan}' plan. Upgrade to generate more.`,
        plan: keyRow.plan,
        monthlyLimit: limit,
        used,
        upgradeUrl: PUBLIC_URL + '/dashboard.html',
      },
    });
    return;
  }
  req.keyRow = keyRow;
  next();
}

async function handleQr(req, res) {
  try {
    const params = req.method === 'GET' ? req.query : { ...req.query, ...req.body };
    const out = await renderQr(params);
    const used = recordUsage(req.keyRow);
    const limit = PLANS[req.keyRow.plan].monthlyLimit;
    res.setHeader('Content-Type', contentTypeFor(req));
    // Responses carry the key's live quota state → never cache through a CDN.
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Ratelimit-Limit', String(limit));
    res.setHeader('X-Ratelimit-Remaining', String(Math.max(0, limit - used)));
    res.setHeader('X-Ratelimit-Period', 'month');
    res.send(out);
  } catch (err) {
    sendError(res, err);
  }
}

app.get('/api/v1/qr', rateLimit({ limit: 120, windowMs: 60_000, keyFn: ipOf }), requireKey, handleQr);
app.post('/api/v1/qr', rateLimit({ limit: 120, windowMs: 60_000, keyFn: ipOf }), requireKey, handleQr);

/** Usage + plan info for the calling key. */
app.get('/api/v1/usage', (req, res) => {
  const keyRow = findKey(readKey(req));
  if (!keyRow) {
    res.status(401).json({ error: { code: 'unauthorized', message: 'Missing or invalid API key.' } });
    return;
  }
  const plan = PLANS[keyRow.plan];
  const used = usageFor(keyRow);
  const now = new Date();
  res.json({
    plan: keyRow.plan,
    planName: plan.name,
    monthlyLimit: plan.monthlyLimit,
    used,
    remaining: Math.max(0, plan.monthlyLimit - used),
    period: currentMonth(),
    resetsOnUtc: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
    stripeStatus: keyRow.stripe_status || null,
    lastUsedAt: keyRow.last_used_at || null,
    createdAt: keyRow.created_at,
    keyName: keyRow.name,
  });
});

// Unknown API routes get a JSON 404 (not the static 404 page).
app.use('/api', (req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: 'Unknown API endpoint.' } });
});

// ---------------------------------------------------------------------------
// Billing (web endpoints, key-based)
// ---------------------------------------------------------------------------

app.post(
  '/api/billing/checkout',
  rateLimit({ limit: 10, windowMs: 3_600_000, keyFn: ipOf }),
  async (req, res) => {
    const plan = String((req.body && req.body.plan) || 'pro');
    if (!PLANS[plan] || plan === 'free') {
      res.status(400).json({ error: { code: 'invalid_plan', message: "plan must be 'pro' or 'business'." } });
      return;
    }
    const keyRow = findKey(readKey(req));
    if (!keyRow) {
      res.status(401).json({ error: { code: 'unauthorized', message: 'Missing or invalid API key.' } });
      return;
    }
    if (!billing.billingConfigured()) {
      res.status(503).json({
        error: {
          code: 'billing_not_configured',
          message: 'Stripe is not configured on this instance yet. See the README (Billing setup) to enable checkout.',
        },
      });
      return;
    }
    if (!billing.priceForPlan(plan)) {
      res.status(503).json({
        error: {
          code: 'billing_not_configured',
          message: `Stripe price ID for the '${plan}' plan is not set (STRIPE_PRICE_${plan.toUpperCase()}_ID).`,
        },
      });
      return;
    }
    try {
      const session = await billing.createCheckoutSession(
        keyRow.id,
        plan,
        PUBLIC_URL + '/dashboard.html?checkout=success',
        PUBLIC_URL + '/dashboard.html?checkout=canceled'
      );
      res.json({ url: session.url, id: session.id });
    } catch (err) {
      console.error('[stripe] checkout failed:', err.message);
      res.status(502).json({ error: { code: 'stripe_error', message: err.message } });
    }
  }
);

app.post('/api/billing/portal', rateLimit({ limit: 10, windowMs: 3_600_000, keyFn: ipOf }), async (req, res) => {
  const keyRow = findKey(readKey(req));
  if (!keyRow) {
    res.status(401).json({ error: { code: 'unauthorized', message: 'Missing or invalid API key.' } });
    return;
  }
  if (!billing.billingConfigured() || !keyRow.stripe_customer_id) {
    res.status(503).json({
      error: { code: 'no_billing', message: 'No billing account on file for this key yet.' },
    });
    return;
  }
  try {
    const session = await billing.createPortalSession(keyRow.id, PUBLIC_URL + '/dashboard.html');
    res.json({ url: session.url });
  } catch (err) {
    console.error('[stripe] portal failed:', err.message);
    res.status(502).json({ error: { code: 'stripe_error', message: err.message } });
  }
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

if (require.main === module) {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[qrforge] API + site listening on http://0.0.0.0:${PORT}`);
    console.log(`[qrforge] billing: ${billing.billingConfigured() ? 'Stripe enabled' : 'NOT configured (free tier only)'}`);
    if (IS_HTTPS) console.log('[qrforge] HSTS enabled (APP_URL is https)');
  });

  // Graceful shutdown for container platforms (SIGTERM on deploy/restart).
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      console.log(`[qrforge] ${sig} received, draining connections…`);
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 10_000).unref();
    });
  }
}

module.exports = { app };
