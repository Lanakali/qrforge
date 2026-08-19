/* QRForge landing page: code tabs, copy button, client-side live demo.
 * The demo generates QR codes entirely in the browser (vendored qrcode lib) —
 * no server required, nothing leaves the page. */
(function () {
  'use strict';

  // ---- code tabs ----
  var tabs = document.querySelectorAll('.code-tab');
  var snippets = {
    curl: document.getElementById('snippet-curl'),
    js: document.getElementById('snippet-js'),
    py: document.getElementById('snippet-py'),
  };
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      tabs.forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      Object.keys(snippets).forEach(function (k) {
        snippets[k].classList.toggle('hidden', k !== tab.dataset.tab);
      });
    });
  });

  var copyBtn = document.getElementById('copy-snippet');
  copyBtn.addEventListener('click', function () {
    var active = document.querySelector('.code-tab.active');
    var text = snippets[active.dataset.tab].innerText;
    function done() {
      copyBtn.textContent = 'copied!';
      setTimeout(function () { copyBtn.textContent = 'copy'; }, 1500);
    }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      done();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  });

  // ---- live demo (100% client-side) ----
  var dataInput = document.getElementById('demo-data');
  var sizeSelect = document.getElementById('demo-size');
  var formatSelect = document.getElementById('demo-format');
  var goBtn = document.getElementById('demo-go');
  var preview = document.getElementById('demo-preview');
  var note = document.getElementById('demo-note');
  var currentUrl = null;

  function ensureImg() {
    var img = preview.querySelector('img');
    if (!img) {
      img = document.createElement('img');
      preview.innerHTML = '';
      preview.appendChild(img);
    }
    return img;
  }

  function demoGenerate() {
    var t0 = performance.now();
    var data = dataInput.value.trim();
    if (!data) {
      note.textContent = 'Type something to encode first.';
      note.style.color = 'var(--warn)';
      return;
    }
    var format = formatSelect.value;
    goBtn.disabled = true;
    goBtn.textContent = 'Generating…';
    note.textContent = '';

    var opts = {
      width: Number(sizeSelect.value),
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: format === 'png' ? '#ffffff' : '#ffffff00' },
    };

    function finish(src, ms) {
      var img = ensureImg();
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      img.src = src;
      img.alt = 'Generated QR code';
      note.textContent = 'Generated in ' + ms + ' ms — right here in your browser. Your text never left this page.';
      note.style.color = '';
      goBtn.disabled = false;
      goBtn.textContent = 'Generate';
    }

    function fail(err) {
      note.textContent = 'Demo error: ' + (err && err.message ? err.message : 'generation failed');
      note.style.color = 'var(--danger)';
      goBtn.disabled = false;
      goBtn.textContent = 'Generate';
    }

    if (format === 'svg') {
      QRCode.toString(data, { type: 'svg', width: Number(sizeSelect.value), margin: 2, errorCorrectionLevel: 'M' })
        .then(function (svg) {
          currentUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
          finish(currentUrl, Math.round(performance.now() - t0));
        })
        .catch(fail);
    } else {
      QRCode.toDataURL(data, opts)
        .then(function (url) {
          finish(url, Math.round(performance.now() - t0));
        })
        .catch(fail);
    }
  }

  goBtn.addEventListener('click', demoGenerate);
  dataInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') demoGenerate();
  });
  demoGenerate();
})();
