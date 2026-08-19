/* QRForge landing page: code tabs, copy button, live demo. */
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
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
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
  });

  // ---- live demo ----
  var dataInput = document.getElementById('demo-data');
  var sizeSelect = document.getElementById('demo-size');
  var formatSelect = document.getElementById('demo-format');
  var goBtn = document.getElementById('demo-go');
  var preview = document.getElementById('demo-preview');
  var note = document.getElementById('demo-note');

  function demoGenerate() {
    var t0 = performance.now();
    var data = dataInput.value.trim();
    if (!data) {
      note.textContent = 'Type something to encode first.';
      note.style.color = 'var(--warn)';
      return;
    }
    goBtn.disabled = true;
    goBtn.textContent = 'Generating…';
    note.textContent = '';
    var url =
      '/api/v1/demo-qr?data=' + encodeURIComponent(data) +
      '&size=' + sizeSelect.value +
      '&format=' + formatSelect.value;
    fetch(url)
      .then(function (res) {
        if (!res.ok) return res.json().then(function (j) { throw new Error(j.error ? j.error.message : 'Request failed'); });
        return res.blob();
      })
      .then(function (blob) {
        var img = preview.querySelector('img');
        if (!img) {
          img = document.createElement('img');
          preview.innerHTML = '';
          preview.appendChild(img);
        }
        img.src = URL.createObjectURL(blob);
        img.alt = 'Generated QR code';
        note.textContent = 'Generated in ' + Math.round(performance.now() - t0) + ' ms by the live API. Free tier: 200 codes/mo with a key.';
        note.style.color = '';
      })
      .catch(function (err) {
        note.textContent = 'Demo error: ' + err.message;
        note.style.color = 'var(--danger)';
      })
      .then(function () {
        goBtn.disabled = false;
        goBtn.textContent = 'Generate';
      });
  }

  goBtn.addEventListener('click', demoGenerate);
  dataInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') demoGenerate();
  });
  demoGenerate();
})();
