'use strict';

// Lightweight fixed-window in-memory rate limiter (per deployment instance).
// Good enough for abuse prevention; swap for a Redis-backed limiter if you
// run multiple instances behind a load balancer.

const buckets = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
}, 60_000).unref();

function rateLimit({ limit, windowMs, keyFn }) {
  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset < now) {
      b = { reset: now + windowMs, count: 0 };
      buckets.set(key, b);
    }
    b.count += 1;
    res.setHeader('Retry-After', Math.ceil((b.reset - now) / 1000));
    if (b.count > limit) {
      res.status(429).json({
        error: {
          code: 'rate_limited',
          message: 'Too many requests. Slow down and try again shortly.',
        },
      });
      return;
    }
    next();
  };
}

module.exports = { rateLimit };
