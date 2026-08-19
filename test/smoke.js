'use strict';

// Smoke test: boots the app on an ephemeral port and exercises the API.
// Run with: npm test

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDb = path.join(os.tmpdir(), 'qrforge-test-' + Date.now() + '.db');
process.env.DATABASE_PATH = tmpDb;
process.env.ALLOW_UNVERIFIED_WEBHOOKS = '0';

const { app } = require('../server');

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log('  ✓ ' + name);
  } else {
    failed++;
    console.log('  ✗ ' + name + (extra ? ' — ' + extra : ''));
  }
}

async function main() {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  // 1. health
  let res = await fetch(base + '/api/v1/health');
  let body = await res.json();
  check('GET /api/v1/health -> 200 ok', res.status === 200 && body.status === 'ok');

  // 2. register
  res = await fetch(base + '/api/v1/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'smoke-test-key' }),
  });
  body = await res.json();
  const apiKey = body.apiKey;
  check('POST /api/v1/register -> 201 + apiKey', res.status === 201 && !!apiKey && apiKey.startsWith('qrf_live_'));
  check('register reports free plan 200/mo', body.plan === 'free' && body.monthlyLimit === 200);

  // 3. QR PNG
  res = await fetch(base + '/api/v1/qr?data=https%3A%2F%2Fqrforge.dev&size=256', {
    headers: { 'X-API-Key': apiKey },
  });
  const png = Buffer.from(await res.arrayBuffer());
  const pngMagic = png.slice(0, 4).toString('hex') === '89504e47';
  check('GET /api/v1/qr -> PNG bytes', res.status === 200 && pngMagic, 'status=' + res.status);
  check('rate headers present', res.headers.get('x-ratelimit-limit') === '200');

  // 4. QR SVG via POST JSON
  res = await fetch(base + '/api/v1/qr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify({ data: 'QRForge smoke test', format: 'svg', ec: 'H', margin: 3 }),
  });
  const svg = await res.text();
  check('POST /api/v1/qr -> SVG', res.status === 200 && svg.includes('<svg'), 'status=' + res.status);

  // 5. custom colors
  res = await fetch(
    base + '/api/v1/qr?data=hi&dark=%23ff0000&light=%2300ff00&format=png',
    { headers: { 'X-API-Key': apiKey } }
  );
  check('custom colors accepted', res.status === 200);

  // 6. missing key
  res = await fetch(base + '/api/v1/qr?data=hi');
  check('missing key -> 401', res.status === 401);

  // 7. bad key
  res = await fetch(base + '/api/v1/qr?data=hi', { headers: { 'X-API-Key': 'qrf_live_bogus' } });
  check('bad key -> 401', res.status === 401);

  // 8. missing data
  res = await fetch(base + '/api/v1/qr', { headers: { 'X-API-Key': apiKey } });
  check('missing data -> 400', res.status === 400);

  // 9. bad color
  res = await fetch(base + '/api/v1/qr?data=hi&dark=not-a-color', { headers: { 'X-API-Key': apiKey } });
  check('bad color -> 400', res.status === 400);

  // 10. usage tracking
  res = await fetch(base + '/api/v1/usage', { headers: { 'X-API-Key': apiKey } });
  body = await res.json();
  check('usage tracked (>=3 codes)', body.used >= 3, 'used=' + body.used);
  check('usage reports plan + limits', body.plan === 'free' && body.monthlyLimit === 200 && body.remaining === 200 - body.used);

  // 11. demo endpoint (no key)
  res = await fetch(base + '/api/v1/demo-qr?data=demo&format=svg');
  const demoSvg = await res.text();
  check('demo-qr works without a key', res.status === 200 && demoSvg.includes('<svg'));

  // 12. landing page
  res = await fetch(base + '/');
  const html = await res.text();
  check('landing page serves QRForge', res.status === 200 && html.includes('QRForge'));

  // 13. dashboard page
  res = await fetch(base + '/dashboard.html');
  check('dashboard page serves', res.status === 200);

  // 14. unknown api route -> JSON 404
  res = await fetch(base + '/api/v1/nope');
  check('unknown API route -> JSON 404', res.status === 404);

  server.close();
  for (const f of [tmpDb, tmpDb + '-wal', tmpDb + '-shm']) {
    try { fs.unlinkSync(f); } catch {}
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
