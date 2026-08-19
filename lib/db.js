'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'qrforge.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS api_keys (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key                TEXT UNIQUE NOT NULL,
  name                   TEXT NOT NULL DEFAULT 'default',
  plan                   TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro','business')),
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  stripe_status          TEXT,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used_at           TEXT
);

CREATE TABLE IF NOT EXISTS usage (
  api_key_id INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  month      TEXT NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (api_key_id, month)
);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key_id INTEGER REFERENCES api_keys(id) ON DELETE SET NULL,
  type       TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_events_key_time ON events(api_key_id, created_at);
`);

module.exports = db;
