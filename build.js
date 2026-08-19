'use strict';

/*
 * build.js — assembles the static site into public/ as fully self-contained
 * HTML files: every <link rel="stylesheet"> and <script src> is inlined, and
 * the site configuration from site.config.json is embedded.
 *
 * Result: each page is ONE file with zero external requests. It works on
 * GitHub Pages, opened straight from disk (file://), in single-file preview
 * viewers, or forwarded in a chat.
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SITE = path.join(ROOT, 'site');
const OUT = path.join(ROOT, 'public');

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));

const css = fs.readFileSync(path.join(SITE, 'css', 'style.css'), 'utf8');
const vendor = fs.readFileSync(path.join(SITE, 'js', 'vendor', 'qrcode.min.js'), 'utf8');
const siteJs = fs.readFileSync(path.join(SITE, 'js', 'site.js'), 'utf8');
const dashJs = fs.readFileSync(path.join(SITE, 'js', 'dashboard.js'), 'utf8');

const configJs = 'window.QRFORGE_CONFIG = ' + JSON.stringify(config, null, 2) + ';';

function replaceOnce(html, needle, replacement, label) {
  const parts = html.split(needle);
  if (parts.length !== 2) {
    console.error(`[build] ERROR: ${label} found ${parts.length - 1} times (expected 1) in a page`);
    process.exit(1);
  }
  return parts.join(replacement);
}

function buildPage(srcFile, outName, scripts) {
  let html = fs.readFileSync(path.join(SITE, srcFile), 'utf8');
  html = replaceOnce(
    html,
    '<link rel="stylesheet" href="css/style.css">',
    '<style>\n' + css + '\n</style>',
    'stylesheet link in ' + srcFile
  );
  if (scripts) {
    html = replaceOnce(
      html,
      '<script src="js/vendor/qrcode.min.js"></script>',
      '<script>\n/* vendored qrcode (npm) — regenerate with: npm run build:vendor */\n' + vendor + '\n</script>',
      'vendor script in ' + srcFile
    );
    html = replaceOnce(
      html,
      '<script src="config.js"></script>',
      '<script>\n/* site configuration (from site.config.json) */\n' + configJs + '\n</script>',
      'config script in ' + srcFile
    );
    html = replaceOnce(
      html,
      scripts.tag,
      '<script>\n' + scripts.code + '\n</script>',
      'page script in ' + srcFile
    );
  }
  fs.writeFileSync(path.join(OUT, outName), html);
  console.log('[build] ' + outName + ' (' + (html.length / 1024).toFixed(1) + ' KB, self-contained)');
}

// fresh output
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

buildPage('index.html', 'index.html', { tag: '<script src="js/site.js"></script>', code: siteJs });
buildPage('dashboard.html', 'dashboard.html', { tag: '<script src="js/dashboard.js"></script>', code: dashJs });
buildPage('404.html', '404.html', null); // 404 has no scripts

// pass-through files
for (const f of ['robots.txt', 'sitemap.xml']) {
  fs.copyFileSync(path.join(SITE, f), path.join(OUT, f));
}

console.log('[build] done → ' + path.relative(ROOT, OUT));
