/* QRForge dashboard: connect key, show usage, upgrade, test. */
(function () {
  'use strict';

  var LS_KEY = 'qrforge_api_key';

  var $ = function (id) { return document.getElementById(id); };
  var keyInput = $('api-key');
  var connectBtn = $('connect-btn');
  var connectMsg = $('connect-msg');
  var usageSection = $('usage-section');
  var billingMsg = $('billing-msg');

  function currentKey() { return (localStorage.getItem(LS_KEY) || '').trim(); }

  function showMsg(el, kind, text) {
    el.className = 'msg ' + kind;
    el.textContent = text;
  }
  function clearMsg(el) { el.className = 'msg'; el.textContent = ''; }

  function connect(key, silent) {
    clearMsg(connectMsg);
    connectBtn.disabled = true;
    fetch('/api/v1/usage', { headers: { 'X-API-Key': key } })
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
        $('stat-reset').textContent = (u.period + ' → ' + d.getUTCMonth() + 1 + '/' + d.getUTCFullYear());
        var pct = Math.min(100, Math.round((u.used / u.monthlyLimit) * 1000) / 10);
        $('progress-bar').style.width = pct + '%';
        var ss = $('stripe-status');
        if (u.stripeStatus) {
          ss.textContent = 'Stripe subscription status: ' + u.stripeStatus;
          ss.style.display = '';
        } else {
          ss.textContent = 'Free plan. Quota resets on the 1st of each month.';
          ss.style.display = '';
        }
        // dim upgrade buttons for current plan
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

  keyInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') connectBtn.click();
  });

  $('disconnect-btn').addEventListener('click', function () {
    localStorage.removeItem(LS_KEY);
    keyInput.value = '';
    usageSection.classList.add('hidden');
    clearMsg(connectMsg);
  });

  // ---- checkout ----
  function checkout(plan) {
    var key = currentKey();
    var btn = $('upgrade-' + plan);
    btn.disabled = true;
    btn.textContent = 'Starting checkout…';
    fetch('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: plan, key: key }),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok) {
            var m = body.error ? body.error.message : 'Checkout failed';
            if (body.error && body.error.code === 'billing_not_configured') {
              showMsg(billingMsg, 'warn', m + ' Billing is enabled by setting Stripe keys in the server environment (see the README).');
            } else {
              showMsg(billingMsg, 'err', m);
            }
            throw new Error(m);
          }
          return body;
        });
      })
      .then(function (body) {
        if (body.url) window.location.href = body.url;
      })
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
    var key = currentKey();
    fetch('/api/billing/portal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: key }),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok) throw new Error(body.error ? body.error.message : 'No billing session');
          return body;
        });
      })
      .then(function (body) {
        if (body.url) window.location.href = body.url;
      })
      .catch(function (err) {
        showMsg(billingMsg, 'warn', 'Billing portal: ' + err.message);
      });
  });

  // checkout return banner
  var params = new URLSearchParams(window.location.search);
  if (params.get('checkout') === 'success') {
    showMsg(billingMsg, 'ok', 'Payment successful — your plan updates automatically within a few seconds. Refresh this page if the badge does not change.');
  } else if (params.get('checkout') === 'canceled') {
    showMsg(billingMsg, 'warn', 'Checkout was canceled — nothing was charged.');
  }

  // ---- test key ----
  $('test-go').addEventListener('click', function () {
    var key = currentKey();
    var data = $('test-data').value.trim();
    var format = $('test-format').value;
    var msg = $('test-msg');
    var preview = $('test-preview');
    clearMsg(msg);
    if (!data) return showMsg(msg, 'err', 'Type something to encode.');
    fetch('/api/v1/qr?data=' + encodeURIComponent(data) + '&format=' + format, {
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
      .catch(function (err) {
        showMsg(msg, 'err', 'Test failed: ' + err.message);
      });
  });

  // auto-connect if a key is stored
  var stored = currentKey();
  if (stored) connect(stored, true);
})();
