/* QRForge dashboard.
 * - "live mode":  QRFORGE_CONFIG.apiBase is set → talk to the hosted API
 *                 (usage, plan, Stripe checkout/portal, key testing).
 * - "demo mode":  apiBase empty → pure client-side QR generator, no API. */
(function () {
  'use strict';

  var CFG = window.QRFORGE_CONFIG || {};
  var API = (CFG.apiBase || '').replace(/\/+$/, '');
  var LS_KEY = 'qrforge_api_key';
  var $ = function (id) { return document.getElementById(id); };

  var keyInput = $('api-key');
  var connectBtn = $('connect-btn');
  var connectMsg = $('connect-msg');
  var usageSection = $('usage-section');
  var connectCard = $('connect-card');
  var billingMsg = $('billing-msg');
  var demoCard = $('demo-mode-card');

  function currentKey() { return (localStorage.getItem(LS_KEY) || '').trim(); }

  function showMsg(el, kind, text) { el.className = 'msg ' + kind; el.textContent = text; }
  function clearMsg(el) { el.className = 'msg'; el.textContent = ''; }

  // ---------------- demo mode (no API deployed) ----------------

  if (!API) {
    connectCard.classList.add('hidden');
    usageSection.classList.add('hidden');
    demoCard.classList.remove('hidden');

    var dData = $('demo-data-2');
    var dSize = $('demo-size-2');
    var dFormat = $('demo-format-2');
    var dBtn = $('demo-go-2');
    var dPreview = $('demo-preview-2');
    var dMsg = $('demo-msg-2');

    dBtn.addEventListener('click', function () {
      var data = dData.value.trim();
      clearMsg(dMsg);
      if (!data) return showMsg(dMsg, 'err', 'Type something to encode.');
      var format = dFormat.value;
      dBtn.disabled = true;
      dBtn.textContent = 'Generating…';
      function done(src) {
        dPreview.style.display = 'block';
        dPreview.innerHTML = '';
        var img = document.createElement('img');
        img.src = src;
        img.alt = 'Generated QR code';
        dPreview.appendChild(img);
        dBtn.disabled = false;
        dBtn.textContent = 'Generate';
      }
      function fail(err) {
        showMsg(dMsg, 'err', 'Generation failed: ' + (err && err.message ? err.message : 'unknown error'));
        dBtn.disabled = false;
        dBtn.textContent = 'Generate';
      }
      if (format === 'svg') {
        QRCode.toString(data, { type: 'svg', width: Number(dSize.value), margin: 2, errorCorrectionLevel: 'M' })
          .then(function (svg) {
            done(URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })));
          })
          .catch(fail);
      } else {
        QRCode.toDataURL(data, { width: Number(dSize.value), margin: 2, errorCorrectionLevel: 'M' })
          .then(done)
          .catch(fail);
      }
    });
    dData.addEventListener('keydown', function (e) { if (e.key === 'Enter') dBtn.click(); });
    dBtn.click();
    return;
  }

  // ---------------- live mode (API deployed) ----------------

  function connect(key) {
    clearMsg(connectMsg);
    connectBtn.disabled = true;
    fetch(API + '/api/v1/usage', { headers: { 'X-API-Key': key } })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok) throw new Error(body.error ? body.error.message : 'Invalid key');
          return body;
        });
      })
      .then(function (u) {
        localStorage.setItem(LS_KEY, key);
        keyInput.value = key;
        usageSection.classList.remove('hidden');
        $('plan-badge').textContent = u.planName + (u.stripeStatus ? ' · ' + u.stripeStatus : '');
        $('stat-used').textContent = u.used.toLocaleString();
        $('stat-remaining').textContent = u.remaining.toLocaleString();
        $('stat-limit').textContent = u.monthlyLimit.toLocaleString();
        var d = new Date(u.resetsOnUtc);
        $('stat-reset').textContent = u.period + ' → ' + (d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
        var pct = Math.min(100, Math.round((u.used / u.monthlyLimit) * 1000) / 10);
        $('progress-bar').style.width = pct + '%';
        var ss = $('stripe-status');
        ss.textContent = u.stripeStatus
          ? 'Stripe subscription status: ' + u.stripeStatus
          : 'Free plan. Quota resets on the 1st of each month.';
        ss.style.display = '';
        var proBtn = $('upgrade-pro'), bizBtn = $('upgrade-business');
        proBtn.disabled = u.plan === 'pro' || u.plan === 'business';
        bizBtn.disabled = u.plan === 'business';
        proBtn.textContent = u.plan === 'pro' ? 'Current plan' : 'Switch to Pro';
        bizBtn.textContent = u.plan === 'business' ? 'Current plan' : 'Switch to Business';
        usageSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      })
      .catch(function (err) {
        usageSection.classList.add('hidden');
        showMsg(connectMsg, 'err', 'Could not connect: ' + err.message);
      })
      .then(function () { connectBtn.disabled = false; });
  }

  connectBtn.addEventListener('click', function () {
    var k = keyInput.value.trim();
    if (!k) return showMsg(connectMsg, 'err', 'Paste your API key first.');
    connect(k);
  });

  keyInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') connectBtn.click(); });

  $('disconnect-btn').addEventListener('click', function () {
    localStorage.removeItem(LS_KEY);
    keyInput.value = '';
    usageSection.classList.add('hidden');
    clearMsg(connectMsg);
  });

  function checkout(plan) {
    var key = currentKey();
    var btn = $('upgrade-' + plan);
    btn.disabled = true;
    btn.textContent = 'Starting checkout…';
    fetch(API + '/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: plan, key: key }),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok) {
            var m = body.error ? body.error.message : 'Checkout failed';
            showMsg(billingMsg, body.error && body.error.code === 'billing_not_configured' ? 'warn' : 'err',
              m + (body.error && body.error.code === 'billing_not_configured'
                ? ' Stripe is enabled by setting the keys in the API server environment (see the README).' : ''));
            throw new Error(m);
          }
          return body;
        });
      })
      .then(function (body) { if (body.url) window.location.href = body.url; })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = plan === 'pro' ? 'Switch to Pro' : 'Switch to Business';
      });
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-plan]'), function (btn) {
    btn.addEventListener('click', function () { checkout(btn.dataset.plan); });
  });

  $('manage-billing').addEventListener('click', function (e) {
    e.preventDefault();
    fetch(API + '/api/billing/portal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: currentKey() }),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok) throw new Error(body.error ? body.error.message : 'No billing session');
          return body;
        });
      })
      .then(function (body) { if (body.url) window.location.href = body.url; })
      .catch(function (err) { showMsg(billingMsg, 'warn', 'Billing portal: ' + err.message); });
  });

  var params = new URLSearchParams(window.location.search);
  if (params.get('checkout') === 'success') {
    showMsg(billingMsg, 'ok', 'Payment successful — your plan updates automatically within a few seconds. Refresh this page if the badge does not change.');
  } else if (params.get('checkout') === 'canceled') {
    showMsg(billingMsg, 'warn', 'Checkout was canceled — nothing was charged.');
  }

  $('test-go').addEventListener('click', function () {
    var key = currentKey();
    var data = $('test-data').value.trim();
    var format = $('test-format').value;
    var msg = $('test-msg');
    var preview = $('test-preview');
    clearMsg(msg);
    if (!data) return showMsg(msg, 'err', 'Type something to encode.');
    fetch(API + '/api/v1/qr?data=' + encodeURIComponent(data) + '&format=' + format, {
      headers: { 'X-API-Key': key },
    })
      .then(function (res) {
        if (!res.ok) return res.json().then(function (j) { throw new Error(j.error ? j.error.message : 'Request failed'); });
        return res.blob();
      })
      .then(function (blob) {
        preview.style.display = 'block';
        preview.innerHTML = '';
        var img = document.createElement('img');
        img.src = URL.createObjectURL(blob);
        img.alt = 'Test QR code';
        preview.appendChild(img);
      })
      .catch(function (err) { showMsg(msg, 'err', 'Test failed: ' + err.message); });
  });

  var stored = currentKey();
  if (stored) connect(stored);
})();
