export type MonitorType = 'http' | 'keyword' | 'json-query' | 'tcp' | 'dns' | 'push';
export type MonitorStatus = 'up' | 'down' | 'degraded' | 'paused' | 'pending';
export type NotificationProvider = 'discord' | 'slack' | 'telegram' | 'ntfy' | 'pushover' | 'webhook';

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  DEV_BYPASS_AUTH?: string;
}

export interface MonitorRow {
  id: number;
  name: string;
  group_name: string;
  tags: string; // JSON string[]
  type: MonitorType;
  url_or_host: string;
  port: number | null;
  method: string;
  headers: string; // JSON Record<string, string>
  body: string;
  timeout_ms: number;
  interval_seconds: number;
  max_retries: number;
  expected_status: string;
  follow_redirects: number;
  ignore_tls: number;
  keyword: string | null;
  keyword_inverted: number;
  json_path: string | null;
  json_expected: string | null;
  json_operator: string;
  dns_record_type: string;
  dns_expected: string | null;
  push_token: string | null;
  active: number;
  is_public: number;
  current_status: MonitorStatus;
  consecutive_failures: number;
  last_checked_at: number | null;
  last_latency_ms: number | null;
  notification_ids: string; // JSON number[]
  created_at: number;
  updated_at: number;
}

export interface HeartbeatRow {
  id: number;
  monitor_id: number;
  status: 'up' | 'down' | 'degraded';
  latency_ms: number;
  status_code: number | null;
  message: string | null;
  timestamp: number;
}

export interface IncidentRow {
  id: number;
  monitor_id: number;
  monitor_name?: string;
  started_at: number;
  resolved_at: number | null;
  cause: string;
}

export interface NotificationChannelRow {
  id: number;
  name: string;
  provider: NotificationProvider;
  config: string; // JSON string
  is_default: number;
  active: number;
  created_at: number;
}

export interface CheckResult {
  status: 'up' | 'down';
  latency_ms: number;
  status_code: number | null;
  message: string;
}

export interface ZeroTrustIdentity {
  authenticated: boolean;
  email: string;
  mode: 'cloudflare_zero_trust' | 'dev_bypass' | 'unconfigured';
  team_domain?: string;
}
