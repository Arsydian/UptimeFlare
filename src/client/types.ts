export type MonitorType = 'http' | 'keyword' | 'json-query' | 'tcp' | 'dns' | 'push';
export type MonitorStatus = 'up' | 'down' | 'degraded' | 'paused' | 'pending';
export type NotificationProvider = 'discord' | 'slack' | 'telegram' | 'ntfy' | 'pushover' | 'webhook';
export type ThemePreference = 'auto' | 'light' | 'dark';

export interface Heartbeat {
  id: number;
  monitor_id: number;
  status: 'up' | 'down' | 'degraded';
  latency_ms: number;
  status_code: number | null;
  message: string | null;
  timestamp: number;
}

export interface Monitor {
  id: number;
  name: string;
  group_name: string;
  tags: string[];
  type: MonitorType;
  url_or_host: string;
  port: number | null;
  method: string;
  headers: string;
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
  notification_ids: number[];
  uptime_24h: number;
  uptime_30d: number;
  avg_latency_24h: number;
  heartbeats: Heartbeat[];
  created_at: number;
  updated_at: number;
}

export interface Incident {
  id: number;
  monitor_id: number;
  monitor_name?: string;
  started_at: number;
  resolved_at: number | null;
  cause: string;
}

export interface NotificationChannel {
  id: number;
  name: string;
  provider: NotificationProvider;
  config: Record<string, string>;
  is_default: number;
  active: number;
  created_at: number;
}

export interface ZeroTrustIdentity {
  authenticated: boolean;
  email: string;
  mode: 'cloudflare_zero_trust' | 'dev_bypass' | 'unconfigured';
  team_domain?: string;
}

export interface SiteSettings {
  site_title: string;
  site_description: string;
  public_status_enabled: string;
  public_announcement: string;
  public_announcement_type: string;
  retention_days: string;
  cf_access_team_domain?: string;
  cf_access_aud?: string;
}

export interface DashboardPayload {
  identity: ZeroTrustIdentity;
  settings: SiteSettings;
  monitors: Monitor[];
  incidents: Incident[];
  notifications: NotificationChannel[];
  server_time: number;
}
