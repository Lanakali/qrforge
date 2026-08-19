'use strict';

const crypto = require('crypto');
const db = require('./db');

const PLANS = {
  free: {
    name: 'Free',
    priceMonthly: 0,
    monthlyLimit: 200,
    blurb: 'For side projects and evaluation.',
  },
  pro: {
    name: 'Pro',
    priceMonthly: 9,
    monthlyLimit: 10000,
    blurb: 'For products and production traffic.',
  },
  business: {
    name: 'Business',
    priceMonthly: 29,
    monthlyLimit: 100000,
    blurb: 'For high-volume workloads and teams.',
  },
};

function generateApiKey() {
  return 'qrf_live_' + crypto.randomBytes(24).toString('base64url');
}

function findKey(apiKey) {
  if (!apiKey) return null;
  return db.prepare('SELECT * FROM api_keys WHERE api_key = ?').get(apiKey) || null;
}

function createKey(name) {
  const apiKey = generateApiKey();
  const safeName = String(name || 'default').slice(0, 80) || 'default';
  const info = db
    .prepare('INSERT INTO api_keys (api_key, name) VALUES (?, ?)')
    .run(apiKey, safeName);
  const keyId = info.lastInsertRowid;
  db.prepare('INSERT OR IGNORE INTO usage (api_key_id, month, count) VALUES (?, strftime(\'%Y-%m\',\'now\'), 0)')
    .run(keyId);
  db.prepare('INSERT INTO events (api_key_id, type) VALUES (?, ?)').run(keyId, 'key.created');
  return { id: keyId, apiKey, name: safeName, plan: 'free' };
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function usageFor(keyRow) {
  const row = db
    .prepare('SELECT count FROM usage WHERE api_key_id = ? AND month = ?')
    .get(keyRow.id, currentMonth());
  return row ? row.count : 0;
}

function recordUsage(keyRow) {
  db.prepare(
    `INSERT INTO usage (api_key_id, month, count) VALUES (?, ?, 1)
     ON CONFLICT(api_key_id, month) DO UPDATE SET count = count + 1`
  ).run(keyRow.id, currentMonth());
  db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    keyRow.id
  );
  return usageFor(keyRow);
}

module.exports = { PLANS, generateApiKey, findKey, createKey, usageFor, recordUsage, currentMonth };
