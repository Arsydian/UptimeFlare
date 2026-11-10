-- UptimeFlare Initial D1 Schema (SQLite)

CREATE TABLE IF NOT EXISTS monitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT 'Core Infrastructure',
  tags TEXT NOT NULL DEFAULT '[]',
  type TEXT NOT NULL DEFAULT 'http', -- 'http' | 'keyword' | 'json-query' | 'tcp' | 'dns' | 'push'
  url_or_host TEXT NOT NULL,
  port INTEGER,
  method TEXT NOT NULL DEFAULT 'GET',
  headers TEXT NOT NULL DEFAULT '{}',
  body TEXT NOT NULL DEFAULT '',
  timeout_ms INTEGER NOT NULL DEFAULT 10000,
  interval_seconds INTEGER NOT NULL DEFAULT 60,
  max_retries INTEGER NOT NULL DEFAULT 2,
  expected_status TEXT NOT NULL DEFAULT '200-299',
  follow_redirects INTEGER NOT NULL DEFAULT 1,
  ignore_tls INTEGER NOT NULL DEFAULT 0,
  keyword TEXT,
  keyword_inverted INTEGER NOT NULL DEFAULT 0,
  json_path TEXT,
  json_expected TEXT,
  json_operator TEXT NOT NULL DEFAULT '==',
  dns_record_type TEXT NOT NULL DEFAULT 'A',
  dns_expected TEXT,
  push_token TEXT UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  is_public INTEGER NOT NULL DEFAULT 1,
  current_status TEXT NOT NULL DEFAULT 'pending', -- 'up' | 'down' | 'degraded' | 'paused' | 'pending'
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_checked_at INTEGER,
  last_latency_ms INTEGER,
  notification_ids TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_monitors_active_checked ON monitors(active, last_checked_at);
CREATE INDEX IF NOT EXISTS idx_monitors_push_token ON monitors(push_token);

CREATE TABLE IF NOT EXISTS heartbeats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id INTEGER NOT NULL,
  status TEXT NOT NULL, -- 'up' | 'down' | 'degraded'
  latency_ms INTEGER NOT NULL,
  status_code INTEGER,
  message TEXT,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_heartbeats_monitor_time ON heartbeats(monitor_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_heartbeats_timestamp ON heartbeats(timestamp);

CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  resolved_at INTEGER,
  cause TEXT NOT NULL,
  FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_incidents_monitor ON incidents(monitor_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_started ON incidents(started_at DESC);

CREATE TABLE IF NOT EXISTS notification_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  provider TEXT NOT NULL, -- 'discord' | 'slack' | 'telegram' | 'ntfy' | 'pushover' | 'webhook'
  config TEXT NOT NULL DEFAULT '{}',
  is_default INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('site_title', 'UptimeFlare'),
  ('site_description', 'Cloudflare Edge Infrastructure & Service Status'),
  ('public_status_enabled', 'false'),
  ('public_announcement', ''),
  ('public_announcement_type', 'info'),
  ('retention_days', '30'),
  ('cf_access_team_domain', ''),
  ('cf_access_aud', ''),
  ('last_cleanup_at', '0');
