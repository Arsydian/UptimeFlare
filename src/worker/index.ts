import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  invalidateAccessSettingsCache,
  requireZeroTrustAuth,
  resolveZeroTrustIdentity,
} from './auth';
import { executeMonitorCheck } from './checker';
import { dispatchChannelAlert } from './notifier';
import { processSingleMonitorCheck, runScheduledChecks } from './scheduler';
import {
  Env,
  HeartbeatRow,
  IncidentRow,
  MonitorRow,
  NotificationChannelRow,
  ZeroTrustIdentity,
} from './types';

const app = new Hono<{ Bindings: Env }>();

app.use('/api/*', cors());

let schemaInitialized = false;

// In-memory Worker caches to minimize D1 rows read
let cachedSettings: { data: Record<string, string>; expiresAt: number } | null = null;
let cachedAggregateStats: {
  map24h: Map<number, { uptime: number; avgLatency: number }>;
  map30d: Map<number, number>;
  expiresAt: number;
} | null = null;

function invalidateSettingsCache(): void {
  cachedSettings = null;
  invalidateAccessSettingsCache();
}

function invalidateAggregateStatsCache(): void {
  cachedAggregateStats = null;
}

async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaInitialized) return;
  try {
    await db
      .prepare('SELECT value FROM settings WHERE key = ? LIMIT 1')
      .bind('site_title')
      .first();
    // Ensure covering indexes and hourly rollup table exist on existing deployments
    await db.batch([
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_heartbeats_monitor_time ON heartbeats(monitor_id, timestamp DESC)'
      ),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_heartbeats_timestamp ON heartbeats(timestamp)'),
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_heartbeats_stats ON heartbeats(monitor_id, timestamp, status, latency_ms)'
      ),
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_incidents_monitor ON incidents(monitor_id, started_at DESC)'
      ),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_incidents_started ON incidents(started_at DESC)'),
      db.prepare(`
        CREATE TABLE IF NOT EXISTS heartbeat_hourly (
          monitor_id INTEGER NOT NULL,
          hour_bucket INTEGER NOT NULL,
          total_count INTEGER NOT NULL DEFAULT 0,
          up_count INTEGER NOT NULL DEFAULT 0,
          down_count INTEGER NOT NULL DEFAULT 0,
          degraded_count INTEGER NOT NULL DEFAULT 0,
          latency_sum INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (monitor_id, hour_bucket),
          FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
        )
      `),
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_heartbeat_hourly_bucket ON heartbeat_hourly(hour_bucket)'
      ),
    ]);

    // One-time backfill of heartbeat_hourly from the last 30 days of heartbeats if empty
    const hasHourly = await db
      .prepare('SELECT 1 AS ok FROM heartbeat_hourly LIMIT 1')
      .first<{ ok: number }>();
    if (!hasHourly) {
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      await db
        .prepare(
          `INSERT OR IGNORE INTO heartbeat_hourly (
             monitor_id, hour_bucket, total_count, up_count, down_count, degraded_count, latency_sum
           )
           SELECT
             monitor_id,
             CAST(timestamp / 3600000 AS INTEGER) * 3600000 AS hour_bucket,
             COUNT(*) AS total_count,
             SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) AS up_count,
             SUM(CASE WHEN status = 'down' THEN 1 ELSE 0 END) AS down_count,
             SUM(CASE WHEN status = 'degraded' THEN 1 ELSE 0 END) AS degraded_count,
             SUM(latency_ms) AS latency_sum
           FROM heartbeats
           WHERE timestamp >= ?
           GROUP BY monitor_id, hour_bucket`
        )
        .bind(thirtyDaysAgo)
        .run();
    }

    schemaInitialized = true;
  } catch {
    // Auto-bootstrap schema if D1 database hasn't had migrations applied yet
    await db.batch([
      db.prepare(`
        CREATE TABLE IF NOT EXISTS monitors (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          group_name TEXT NOT NULL DEFAULT 'Core Infrastructure',
          tags TEXT NOT NULL DEFAULT '[]',
          type TEXT NOT NULL DEFAULT 'http',
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
          current_status TEXT NOT NULL DEFAULT 'pending',
          consecutive_failures INTEGER NOT NULL DEFAULT 0,
          last_checked_at INTEGER,
          last_latency_ms INTEGER,
          notification_ids TEXT NOT NULL DEFAULT '[]',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `),
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_monitors_active_checked ON monitors(active, last_checked_at)'
      ),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_monitors_push_token ON monitors(push_token)'),
      db.prepare(`
        CREATE TABLE IF NOT EXISTS heartbeats (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          monitor_id INTEGER NOT NULL,
          status TEXT NOT NULL,
          latency_ms INTEGER NOT NULL,
          status_code INTEGER,
          message TEXT,
          timestamp INTEGER NOT NULL,
          FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
        )
      `),
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_heartbeats_monitor_time ON heartbeats(monitor_id, timestamp DESC)'
      ),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_heartbeats_timestamp ON heartbeats(timestamp)'),
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_heartbeats_stats ON heartbeats(monitor_id, timestamp, status, latency_ms)'
      ),
      db.prepare(`
        CREATE TABLE IF NOT EXISTS heartbeat_hourly (
          monitor_id INTEGER NOT NULL,
          hour_bucket INTEGER NOT NULL,
          total_count INTEGER NOT NULL DEFAULT 0,
          up_count INTEGER NOT NULL DEFAULT 0,
          down_count INTEGER NOT NULL DEFAULT 0,
          degraded_count INTEGER NOT NULL DEFAULT 0,
          latency_sum INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (monitor_id, hour_bucket),
          FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
        )
      `),
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_heartbeat_hourly_bucket ON heartbeat_hourly(hour_bucket)'
      ),
      db.prepare(`
        CREATE TABLE IF NOT EXISTS incidents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          monitor_id INTEGER NOT NULL,
          started_at INTEGER NOT NULL,
          resolved_at INTEGER,
          cause TEXT NOT NULL,
          FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
        )
      `),
      db.prepare(
        'CREATE INDEX IF NOT EXISTS idx_incidents_monitor ON incidents(monitor_id, started_at DESC)'
      ),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_incidents_started ON incidents(started_at DESC)'),
      db.prepare(`
        CREATE TABLE IF NOT EXISTS notification_channels (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          provider TEXT NOT NULL,
          config TEXT NOT NULL DEFAULT '{}',
          is_default INTEGER NOT NULL DEFAULT 1,
          active INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL
        )
      `),
      db.prepare(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `),
      db.prepare(`
        INSERT OR IGNORE INTO settings (key, value) VALUES
          ('site_title', 'UptimeFlare'),
          ('site_description', 'Cloudflare Edge Infrastructure & Service Status'),
          ('public_status_enabled', 'false'),
          ('public_announcement', ''),
          ('public_announcement_type', 'info'),
          ('retention_days', '30'),
          ('cf_access_team_domain', ''),
          ('cf_access_aud', ''),
          ('last_cleanup_at', '0')
      `),
    ]);
    schemaInitialized = true;
  }
}

function generatePushToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function getSettingsMap(db: D1Database, bypassCache = false): Promise<Record<string, string>> {
  const now = Date.now();
  if (!bypassCache && cachedSettings && cachedSettings.expiresAt > now) {
    return cachedSettings.data;
  }

  const { results } = await db
    .prepare('SELECT key, value FROM settings')
    .all<{ key: string; value: string }>();
  const out: Record<string, string> = {
    site_title: 'UptimeFlare',
    site_description: 'Cloudflare Edge Infrastructure & Service Status',
    public_status_enabled: 'false',
    public_announcement: '',
    public_announcement_type: 'info',
    retention_days: '30',
    cf_access_team_domain: '',
    cf_access_aud: '',
  };
  for (const r of results || []) {
    out[r.key] = r.value;
  }

  cachedSettings = {
    data: out,
    expiresAt: now + 60 * 1000, // Cache settings for 60s
  };
  return out;
}

async function getAggregateStats(db: D1Database) {
  const now = Date.now();
  if (cachedAggregateStats && cachedAggregateStats.expiresAt > now) {
    return {
      map24h: cachedAggregateStats.map24h,
      map30d: cachedAggregateStats.map30d,
    };
  }

  const dayAgoBucket = Math.floor((now - 24 * 60 * 60 * 1000) / 3600000) * 3600000;
  const thirtyDaysAgoBucket = Math.floor((now - 30 * 24 * 60 * 60 * 1000) / 3600000) * 3600000;

  // Query pre-aggregated hourly rollups (max 720 rows/monitor for 30d instead of 43,200+ raw heartbeats)
  const { results } = await db
    .prepare(
      `SELECT monitor_id,
              SUM(total_count) as total_30d,
              SUM(up_count) as up_30d,
              SUM(CASE WHEN hour_bucket >= ? THEN total_count ELSE 0 END) as total_24h,
              SUM(CASE WHEN hour_bucket >= ? THEN up_count ELSE 0 END) as up_24h,
              SUM(CASE WHEN hour_bucket >= ? THEN latency_sum ELSE 0 END) as latency_sum_24h
       FROM heartbeat_hourly
       WHERE hour_bucket >= ?
       GROUP BY monitor_id`
    )
    .bind(dayAgoBucket, dayAgoBucket, dayAgoBucket, thirtyDaysAgoBucket)
    .all<{
      monitor_id: number;
      total_30d: number;
      up_30d: number;
      total_24h: number;
      up_24h: number;
      latency_sum_24h: number;
    }>();

  const map24h = new Map<number, { uptime: number; avgLatency: number }>();
  const map30d = new Map<number, number>();

  for (const row of results || []) {
    const pct30 = row.total_30d > 0 ? Number(((row.up_30d / row.total_30d) * 100).toFixed(2)) : 100;
    map30d.set(row.monitor_id, pct30);

    const pct24 = row.total_24h > 0 ? Number(((row.up_24h / row.total_24h) * 100).toFixed(2)) : 100;
    const avgLatency24h = row.total_24h > 0 ? Math.round(row.latency_sum_24h / row.total_24h) : 0;
    map24h.set(row.monitor_id, {
      uptime: pct24,
      avgLatency: avgLatency24h,
    });
  }

  cachedAggregateStats = {
    map24h,
    map30d,
    expiresAt: now + 10 * 60 * 1000, // Cache 24h & 30d percentages for 10 minutes
  };

  return { map24h, map30d };
}

async function enrichMonitorsWithTelemetry(
  db: D1Database,
  monitors: MonitorRow[],
  sanitizeForPublic = false
) {
  if (monitors.length === 0) return [];

  // 1. Fetch cached 24h & 30d aggregate stats (computed at most once every 5 minutes)
  // 2. Fetch recent 60 heartbeats per monitor via indexed LIMIT 60 queries in a single D1 batch
  //    (Uses idx_heartbeats_monitor_time so SQLite reads at most 60 rows per monitor instead of scanning the table!)
  const beatQueries = monitors.map((m) =>
    db
      .prepare(
        `SELECT id, monitor_id, status, latency_ms, status_code, message, timestamp
         FROM heartbeats
         WHERE monitor_id = ?
         ORDER BY timestamp DESC
         LIMIT 60`
      )
      .bind(m.id)
  );

  const [{ map24h, map30d }, batchResults] = await Promise.all([
    getAggregateStats(db),
    db.batch<HeartbeatRow>(beatQueries),
  ]);

  const beatsByMonitor = new Map<number, HeartbeatRow[]>();
  monitors.forEach((m, idx) => {
    const rows = batchResults[idx]?.results || [];
    // Reverse to chronological ascending order for heartbeat bars & charts
    beatsByMonitor.set(m.id, rows.slice().reverse());
  });

  return monitors.map((m) => {
    const s24 = map24h.get(m.id);
    const s30 = map30d.get(m.id);
    const heartbeats = beatsByMonitor.get(m.id) || [];

    let parsedTags: string[] = [];
    try {
      parsedTags = JSON.parse(m.tags || '[]');
    } catch {
      parsedTags = [];
    }

    let parsedNotificationIds: number[] = [];
    try {
      parsedNotificationIds = JSON.parse(m.notification_ids || '[]');
    } catch {
      parsedNotificationIds = [];
    }

    if (sanitizeForPublic) {
      return {
        id: m.id,
        name: m.name,
        group_name: m.group_name,
        tags: parsedTags,
        type: m.type,
        interval_seconds: m.interval_seconds,
        current_status: m.active === 0 ? 'paused' : m.current_status,
        last_checked_at: m.last_checked_at,
        last_latency_ms: m.last_latency_ms,
        uptime_24h: s24 ? s24.uptime : 100,
        uptime_30d: s30 !== undefined ? s30 : 100,
        avg_latency_24h: s24 ? s24.avgLatency : m.last_latency_ms || 0,
        heartbeats,
      };
    }

    return {
      ...m,
      tags: parsedTags,
      notification_ids: parsedNotificationIds,
      current_status: m.active === 0 ? 'paused' : m.current_status,
      uptime_24h: s24 ? s24.uptime : 100,
      uptime_30d: s30 !== undefined ? s30 : 100,
      avg_latency_24h: s24 ? s24.avgLatency : m.last_latency_ms || 0,
      heartbeats,
    };
  });
}

// ============================================================================
// 1. PUBLIC & INBOUND PUSH ENDPOINTS (Unauthenticated / Token-Authenticated)
// ============================================================================

app.get('/api/health', (c) => {
  return c.json({
    status: 'operational',
    service: 'UptimeFlare',
    edge: true,
    timestamp: Date.now(),
  });
});

app.get('/api/public/status', async (c) => {
  await ensureSchema(c.env.uf_db);
  const settings = await getSettingsMap(c.env.uf_db);
  if (settings.public_status_enabled === 'false') {
    return c.json({ error: 'Public status page is disabled by administrator.' }, 403);
  }

  const { results: publicMonitors } = await c.env.uf_db.prepare(
    'SELECT * FROM monitors WHERE is_public = 1 ORDER BY group_name ASC, name ASC'
  ).all<MonitorRow>();

  const enriched = await enrichMonitorsWithTelemetry(c.env.uf_db, publicMonitors || [], true);

  const { results: publicIncidents } = await c.env.uf_db.prepare(
    `SELECT i.*, m.name as monitor_name
     FROM incidents i
     JOIN monitors m ON m.id = i.monitor_id
     WHERE m.is_public = 1
     ORDER BY i.started_at DESC
     LIMIT 25`
  ).all<IncidentRow>();

  return c.json({
    settings: {
      site_title: settings.site_title,
      site_description: settings.site_description,
      public_announcement: settings.public_announcement,
      public_announcement_type: settings.public_announcement_type,
    },
    monitors: enriched,
    incidents: publicIncidents || [],
    generated_at: Date.now(),
  });
});

app.all('/api/push/:token', async (c) => {
  await ensureSchema(c.env.uf_db);
  const token = c.req.param('token').trim();
  if (!token) {
    return c.json({ ok: false, error: 'Missing push token' }, 400);
  }

  const monitor = await c.env.uf_db.prepare('SELECT * FROM monitors WHERE push_token = ? LIMIT 1')
    .bind(token)
    .first<MonitorRow>();

  if (!monitor) {
    return c.json({ ok: false, error: 'Invalid push token' }, 404);
  }

  if (monitor.active === 0) {
    return c.json({ ok: false, error: 'Monitor is paused' }, 423);
  }

  const statusParam = (c.req.query('status') || 'up').toLowerCase();
  const msgParam = c.req.query('msg') || 'OK (Push heartbeat received)';
  const pingParam = Number(c.req.query('ping') || '1');
  const latencyMs = Number.isNaN(pingParam) || pingParam < 0 ? 1 : Math.round(pingParam);

  const outcome = await processSingleMonitorCheck(
    c.env.uf_db,
    monitor,
    {
      status: statusParam === 'down' ? 'down' : 'up',
      latency_ms: latencyMs,
      status_code: statusParam === 'down' ? 500 : 200,
      message: msgParam,
    },
    c.env
  );
  invalidateAggregateStatsCache();

  return c.json({
    ok: true,
    monitor_id: monitor.id,
    status: outcome.newStatus,
  });
});

// ============================================================================
// 2. CLOUDFLARE ZERO TRUST PROTECTED ADMIN ROUTES
// ============================================================================

app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path === '/api/health') {
    return next();
  }
  if (!c.env.uf_db) {
    return c.json(
      {
        error:
          "D1 database binding 'uf_db' is not configured. In the Cloudflare Dashboard, open Workers & Pages -> uptimeflare -> Settings -> Bindings and add a D1 database binding with Variable name 'uf_db'.",
        code: 'uf_db_BINDING_MISSING',
      },
      503
    );
  }
  if (path === '/api/public/status' || path.startsWith('/api/push/')) {
    return next();
  }
  await ensureSchema(c.env.uf_db);
  return requireZeroTrustAuth(c, next);
});

app.get('/api/auth/me', async (c) => {
  const identity =
    (c.get('identity' as never) as ZeroTrustIdentity | undefined) ||
    (await resolveZeroTrustIdentity(c));
  return c.json(identity);
});

app.get('/api/dashboard', async (c) => {
  const identity =
    (c.get('identity' as never) as ZeroTrustIdentity | undefined) ||
    (await resolveZeroTrustIdentity(c));

  const [monitorsRes, incidentsRes, settings, channelsRes] = await Promise.all([
    c.env.uf_db.prepare('SELECT * FROM monitors ORDER BY group_name ASC, name ASC').all<MonitorRow>(),
    c.env.uf_db.prepare(
      `SELECT i.*, m.name as monitor_name
       FROM incidents i
       JOIN monitors m ON m.id = i.monitor_id
       ORDER BY i.started_at DESC
       LIMIT 50`
    ).all<IncidentRow>(),
    getSettingsMap(c.env.uf_db),
    c.env.uf_db.prepare('SELECT * FROM notification_channels ORDER BY id ASC').all<NotificationChannelRow>(),
  ]);

  const enrichedMonitors = await enrichMonitorsWithTelemetry(
    c.env.uf_db,
    monitorsRes.results || [],
    false
  );

  const channels = (channelsRes.results || []).map((ch) => {
    let parsedConfig = {};
    try {
      parsedConfig = JSON.parse(ch.config || '{}');
    } catch {
      parsedConfig = {};
    }
    return {
      ...ch,
      config: parsedConfig,
    };
  });

  return c.json({
    identity,
    settings,
    monitors: enrichedMonitors,
    incidents: incidentsRes.results || [],
    notifications: channels,
    postlet_env: {
      api_url: Boolean(c.env.POSTLET_API_URL?.trim()),
      api_key: Boolean(c.env.POSTLET_API_KEY?.trim()),
      from_email: Boolean(c.env.POSTLET_FROM_EMAIL?.trim()),
      cf_service_auth: Boolean(
        (c.env.POSTLET_CF_ACCESS_CLIENT_ID || c.env.CF_ACCESS_CLIENT_ID)?.trim() &&
          (c.env.POSTLET_CF_ACCESS_CLIENT_SECRET || c.env.CF_ACCESS_CLIENT_SECRET)?.trim()
      ),
      service_auth_secret: Boolean(c.env.POSTLET_SERVICE_AUTH_SECRET?.trim()),
    },
    server_time: Date.now(),
  });
});

app.get('/api/monitors/:id/history', async (c) => {
  const id = Number(c.req.param('id'));
  const range = c.req.query('range') === '7d' ? '7d' : '24h';
  const now = Date.now();

  if (range === '7d') {
    // Query pre-aggregated hourly rollups: at most 168 rows read for a full 7-day window
    const cutoffBucket = Math.floor((now - 7 * 24 * 60 * 60 * 1000) / 3600000) * 3600000;
    const [hourlyRes, incidentsRes] = await Promise.all([
      c.env.uf_db.prepare(
        `SELECT hour_bucket, total_count, up_count, down_count, degraded_count, latency_sum
         FROM heartbeat_hourly
         WHERE monitor_id = ? AND hour_bucket >= ?
         ORDER BY hour_bucket ASC`
      )
        .bind(id, cutoffBucket)
        .all<{
          hour_bucket: number;
          total_count: number;
          up_count: number;
          down_count: number;
          degraded_count: number;
          latency_sum: number;
        }>(),
      c.env.uf_db.prepare(
        `SELECT * FROM incidents WHERE monitor_id = ? ORDER BY started_at DESC LIMIT 30`
      )
        .bind(id)
        .all<IncidentRow>(),
    ]);

    const heartbeats: HeartbeatRow[] = (hourlyRes.results || []).map((row) => {
      const totalCount = Number(row.total_count) || 1;
      const downCount = Number(row.down_count) || 0;
      const degradedCount = Number(row.degraded_count) || 0;
      const avgLatency = Math.round((Number(row.latency_sum) || 0) / totalCount);
      const status: HeartbeatRow['status'] =
        downCount > 0 ? 'down' : degradedCount > 0 ? 'degraded' : 'up';
      const message =
        downCount > 0
          ? `${downCount}/${totalCount} checks down`
          : degradedCount > 0
            ? `${degradedCount}/${totalCount} checks degraded`
            : totalCount > 1
              ? `OK (${totalCount} checks avg)`
              : 'OK';

      return {
        id: Number(row.hour_bucket),
        monitor_id: id,
        status,
        latency_ms: avgLatency,
        status_code: downCount > 0 ? 500 : 200,
        message,
        timestamp: Number(row.hour_bucket),
      };
    });

    return c.json({
      heartbeats,
      incidents: incidentsRes.results || [],
    });
  }

  // 24h view: 5-minute buckets covering the full 24h window via idx_heartbeats_stats covering index
  const cutoff = now - 24 * 60 * 60 * 1000;
  const bucketMs = 5 * 60 * 1000;

  const [beatsRes, incidentsRes] = await Promise.all([
    c.env.uf_db.prepare(
      `SELECT
         CAST(timestamp / ? AS INTEGER) AS bucket,
         MAX(timestamp) AS timestamp,
         ROUND(AVG(latency_ms)) AS latency_ms,
         COUNT(*) AS sample_count,
         SUM(CASE WHEN status = 'down' THEN 1 ELSE 0 END) AS down_count,
         SUM(CASE WHEN status = 'degraded' THEN 1 ELSE 0 END) AS degraded_count
       FROM heartbeats
       WHERE monitor_id = ? AND timestamp >= ?
       GROUP BY bucket
       ORDER BY bucket ASC`
    )
      .bind(bucketMs, id, cutoff)
      .all<{
        bucket: number;
        timestamp: number;
        latency_ms: number;
        sample_count: number;
        down_count: number;
        degraded_count: number;
      }>(),
    c.env.uf_db.prepare(
      `SELECT * FROM incidents WHERE monitor_id = ? ORDER BY started_at DESC LIMIT 30`
    )
      .bind(id)
      .all<IncidentRow>(),
  ]);

  const heartbeats: HeartbeatRow[] = (beatsRes.results || []).map((row) => {
    const downCount = Number(row.down_count) || 0;
    const degradedCount = Number(row.degraded_count) || 0;
    const sampleCount = Number(row.sample_count) || 1;
    const status: HeartbeatRow['status'] =
      downCount > 0 ? 'down' : degradedCount > 0 ? 'degraded' : 'up';
    const message =
      downCount > 0
        ? `${downCount}/${sampleCount} checks down`
        : degradedCount > 0
          ? `${degradedCount}/${sampleCount} checks degraded`
          : sampleCount > 1
            ? `OK (${sampleCount} checks avg)`
            : 'OK';

    return {
      id: Number(row.bucket),
      monitor_id: id,
      status,
      latency_ms: Math.round(Number(row.latency_ms) || 0),
      status_code: downCount > 0 ? 500 : 200,
      message,
      timestamp: Number(row.timestamp),
    };
  });

  return c.json({
    heartbeats,
    incidents: incidentsRes.results || [],
  });
});

app.post('/api/monitors/probe', async (c) => {
  const body = await c.req.json<Partial<MonitorRow>>();
  const mockMonitor: MonitorRow = {
    id: 0,
    name: body.name || 'Ad-hoc Probe',
    group_name: body.group_name || 'General',
    tags: '[]',
    type: body.type || 'http',
    url_or_host: body.url_or_host || '',
    port: body.port ? Number(body.port) : null,
    method: body.method || 'GET',
    headers: typeof body.headers === 'string' ? body.headers : JSON.stringify(body.headers || {}),
    body: body.body || '',
    timeout_ms: Number(body.timeout_ms) || 10000,
    interval_seconds: Number(body.interval_seconds) || 60,
    max_retries: Number(body.max_retries ?? 2),
    expected_status: body.expected_status || '200-299',
    follow_redirects: body.follow_redirects !== undefined ? Number(body.follow_redirects) : 1,
    ignore_tls: body.ignore_tls !== undefined ? Number(body.ignore_tls) : 0,
    keyword: body.keyword || null,
    keyword_inverted: body.keyword_inverted ? 1 : 0,
    json_path: body.json_path || null,
    json_expected: body.json_expected ?? null,
    json_operator: body.json_operator || '==',
    dns_record_type: body.dns_record_type || 'A',
    dns_expected: body.dns_expected || null,
    push_token: null,
    active: 1,
    is_public: 1,
    current_status: 'pending',
    consecutive_failures: 0,
    last_checked_at: null,
    last_latency_ms: null,
    notification_ids: '[]',
    created_at: Date.now(),
    updated_at: Date.now(),
  };

  if (mockMonitor.type === 'push') {
    return c.json({
      status: 'up',
      latency_ms: 1,
      status_code: 200,
      message: 'Push monitor ready — remote server will call the generated Push URL.',
    });
  }

  const result = await executeMonitorCheck(mockMonitor);
  return c.json(result);
});

app.post('/api/monitors', async (c) => {
  const payload = await c.req.json<Record<string, unknown>>();
  const now = Date.now();
  const type = String(payload.type || 'http') as MonitorRow['type'];
  const name = String(payload.name || '').trim();
  const urlOrHost =
    type === 'push'
      ? String(payload.url_or_host || 'inbound-push-agent').trim()
      : String(payload.url_or_host || '').trim();

  if (!name || !urlOrHost) {
    return c.json({ error: 'Monitor name and target URL/hostname are required.' }, 400);
  }

  const pushToken = type === 'push' ? generatePushToken() : null;
  const tagsJson = Array.isArray(payload.tags)
    ? JSON.stringify(payload.tags)
    : typeof payload.tags === 'string'
      ? payload.tags
      : '[]';

  const headersJson =
    typeof payload.headers === 'object' && payload.headers !== null
      ? JSON.stringify(payload.headers)
      : String(payload.headers || '{}');

  const notifIdsJson = Array.isArray(payload.notification_ids)
    ? JSON.stringify(payload.notification_ids)
    : '[]';

  const insertRes = await c.env.uf_db.prepare(
    `INSERT INTO monitors (
      name, group_name, tags, type, url_or_host, port, method, headers, body,
      timeout_ms, interval_seconds, max_retries, expected_status, follow_redirects,
      ignore_tls, keyword, keyword_inverted, json_path, json_expected, json_operator,
      dns_record_type, dns_expected, push_token, active, is_public, current_status,
      consecutive_failures, notification_ids, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
  )
    .bind(
      name,
      String(payload.group_name || 'Core Infrastructure').trim(),
      tagsJson,
      type,
      urlOrHost,
      payload.port ? Number(payload.port) : null,
      String(payload.method || 'GET').toUpperCase(),
      headersJson,
      String(payload.body || ''),
      Math.max(1000, Number(payload.timeout_ms) || 10000),
      Math.max(30, Number(payload.interval_seconds) || 60),
      Math.max(0, Number(payload.max_retries ?? 2)),
      String(payload.expected_status || '200-299').trim(),
      payload.follow_redirects === false || payload.follow_redirects === 0 ? 0 : 1,
      payload.ignore_tls ? 1 : 0,
      payload.keyword ? String(payload.keyword) : null,
      payload.keyword_inverted ? 1 : 0,
      payload.json_path ? String(payload.json_path) : null,
      payload.json_expected !== undefined && payload.json_expected !== null
        ? String(payload.json_expected)
        : null,
      String(payload.json_operator || '=='),
      String(payload.dns_record_type || 'A').toUpperCase(),
      payload.dns_expected ? String(payload.dns_expected) : null,
      pushToken,
      payload.active === false || payload.active === 0 ? 0 : 1,
      payload.is_public === false || payload.is_public === 0 ? 0 : 1,
      type === 'push' ? 'pending' : 'pending',
      notifIdsJson,
      now,
      now
    )
    .run();

  const newId = Number(insertRes.meta.last_row_id);
  const createdMonitor = await c.env.uf_db.prepare('SELECT * FROM monitors WHERE id = ?')
    .bind(newId)
    .first<MonitorRow>();

  // Trigger an immediate initial check for active non-push monitors
  if (createdMonitor && createdMonitor.active === 1 && createdMonitor.type !== 'push') {
    await processSingleMonitorCheck(c.env.uf_db, createdMonitor, undefined, c.env);
  }
  invalidateAggregateStatsCache();

  const updated = await c.env.uf_db.prepare('SELECT * FROM monitors WHERE id = ?')
    .bind(newId)
    .first<MonitorRow>();

  const enriched = updated ? await enrichMonitorsWithTelemetry(c.env.uf_db, [updated]) : [];
  return c.json({ monitor: enriched[0] || null }, 201);
});

app.put('/api/monitors/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const existing = await c.env.uf_db.prepare('SELECT * FROM monitors WHERE id = ?')
    .bind(id)
    .first<MonitorRow>();

  if (!existing) {
    return c.json({ error: 'Monitor not found' }, 404);
  }

  const payload = await c.req.json<Record<string, unknown>>();
  const now = Date.now();
  const type = String(payload.type || existing.type) as MonitorRow['type'];
  const pushToken =
    type === 'push' ? existing.push_token || generatePushToken() : existing.push_token;

  const tagsJson = Array.isArray(payload.tags)
    ? JSON.stringify(payload.tags)
    : typeof payload.tags === 'string'
      ? payload.tags
      : existing.tags;

  const headersJson =
    typeof payload.headers === 'object' && payload.headers !== null
      ? JSON.stringify(payload.headers)
      : typeof payload.headers === 'string'
        ? payload.headers
        : existing.headers;

  const notifIdsJson = Array.isArray(payload.notification_ids)
    ? JSON.stringify(payload.notification_ids)
    : existing.notification_ids;

  await c.env.uf_db.prepare(
    `UPDATE monitors SET
      name = ?, group_name = ?, tags = ?, type = ?, url_or_host = ?, port = ?,
      method = ?, headers = ?, body = ?, timeout_ms = ?, interval_seconds = ?,
      max_retries = ?, expected_status = ?, follow_redirects = ?, ignore_tls = ?,
      keyword = ?, keyword_inverted = ?, json_path = ?, json_expected = ?, json_operator = ?,
      dns_record_type = ?, dns_expected = ?, push_token = ?, active = ?, is_public = ?,
      notification_ids = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      String(payload.name || existing.name).trim(),
      String(payload.group_name || existing.group_name).trim(),
      tagsJson,
      type,
      String(payload.url_or_host || existing.url_or_host).trim(),
      payload.port !== undefined && payload.port !== null && payload.port !== ''
        ? Number(payload.port)
        : null,
      String(payload.method || existing.method).toUpperCase(),
      headersJson,
      payload.body !== undefined ? String(payload.body) : existing.body,
      Math.max(1000, Number(payload.timeout_ms) || existing.timeout_ms),
      Math.max(30, Number(payload.interval_seconds) || existing.interval_seconds),
      Math.max(0, Number(payload.max_retries ?? existing.max_retries)),
      String(payload.expected_status || existing.expected_status).trim(),
      payload.follow_redirects === false || payload.follow_redirects === 0 ? 0 : 1,
      payload.ignore_tls ? 1 : 0,
      payload.keyword !== undefined ? (payload.keyword ? String(payload.keyword) : null) : existing.keyword,
      payload.keyword_inverted ? 1 : 0,
      payload.json_path !== undefined ? (payload.json_path ? String(payload.json_path) : null) : existing.json_path,
      payload.json_expected !== undefined
        ? payload.json_expected !== null
          ? String(payload.json_expected)
          : null
        : existing.json_expected,
      String(payload.json_operator || existing.json_operator || '=='),
      String(payload.dns_record_type || existing.dns_record_type || 'A').toUpperCase(),
      payload.dns_expected !== undefined
        ? payload.dns_expected
          ? String(payload.dns_expected)
          : null
        : existing.dns_expected,
      pushToken,
      payload.active === false || payload.active === 0 ? 0 : 1,
      payload.is_public === false || payload.is_public === 0 ? 0 : 1,
      notifIdsJson,
      now,
      id
    )
    .run();

  const updated = await c.env.uf_db.prepare('SELECT * FROM monitors WHERE id = ?')
    .bind(id)
    .first<MonitorRow>();
  const enriched = updated ? await enrichMonitorsWithTelemetry(c.env.uf_db, [updated]) : [];
  return c.json({ monitor: enriched[0] || null });
});

app.patch('/api/monitors/:id/toggle', async (c) => {
  const id = Number(c.req.param('id'));
  const existing = await c.env.uf_db.prepare('SELECT * FROM monitors WHERE id = ?')
    .bind(id)
    .first<MonitorRow>();

  if (!existing) {
    return c.json({ error: 'Monitor not found' }, 404);
  }

  const nextActive = existing.active === 1 ? 0 : 1;
  const nextStatus = nextActive === 0 ? 'paused' : 'pending';
  const now = Date.now();

  await c.env.uf_db.prepare(
    'UPDATE monitors SET active = ?, current_status = ?, updated_at = ? WHERE id = ?'
  )
    .bind(nextActive, nextStatus, now, id)
    .run();

  const refreshed = await c.env.uf_db.prepare('SELECT * FROM monitors WHERE id = ?')
    .bind(id)
    .first<MonitorRow>();

  if (refreshed && nextActive === 1 && refreshed.type !== 'push') {
    await processSingleMonitorCheck(c.env.uf_db, refreshed, undefined, c.env);
    invalidateAggregateStatsCache();
  }

  const finalRow = await c.env.uf_db.prepare('SELECT * FROM monitors WHERE id = ?')
    .bind(id)
    .first<MonitorRow>();
  const enriched = finalRow ? await enrichMonitorsWithTelemetry(c.env.uf_db, [finalRow]) : [];
  return c.json({ monitor: enriched[0] || null });
});

app.post('/api/monitors/:id/check', async (c) => {
  const id = Number(c.req.param('id'));
  const monitor = await c.env.uf_db.prepare('SELECT * FROM monitors WHERE id = ?')
    .bind(id)
    .first<MonitorRow>();

  if (!monitor) {
    return c.json({ error: 'Monitor not found' }, 404);
  }

  const outcome = await processSingleMonitorCheck(c.env.uf_db, monitor, undefined, c.env);
  invalidateAggregateStatsCache();
  const updated = await c.env.uf_db.prepare('SELECT * FROM monitors WHERE id = ?')
    .bind(id)
    .first<MonitorRow>();
  const enriched = updated ? await enrichMonitorsWithTelemetry(c.env.uf_db, [updated]) : [];

  return c.json({
    outcome,
    monitor: enriched[0] || null,
  });
});

app.delete('/api/monitors/:id', async (c) => {
  const id = Number(c.req.param('id'));
  await c.env.uf_db.batch([
    c.env.uf_db.prepare('DELETE FROM heartbeats WHERE monitor_id = ?').bind(id),
    c.env.uf_db.prepare('DELETE FROM heartbeat_hourly WHERE monitor_id = ?').bind(id),
    c.env.uf_db.prepare('DELETE FROM incidents WHERE monitor_id = ?').bind(id),
    c.env.uf_db.prepare('DELETE FROM monitors WHERE id = ?').bind(id),
  ]);
  invalidateAggregateStatsCache();
  return c.json({ deleted: true, id });
});

// ============================================================================
// 3. NOTIFICATION CHANNELS CRUD & TEST
// ============================================================================

app.post('/api/notifications', async (c) => {
  const body = await c.req.json<{
    name: string;
    provider: string;
    config: Record<string, string>;
    is_default?: boolean;
    active?: boolean;
  }>();

  if (!body.name || !body.provider) {
    return c.json({ error: 'Channel name and provider are required' }, 400);
  }

  const res = await c.env.uf_db.prepare(
    `INSERT INTO notification_channels (name, provider, config, is_default, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      body.name.trim(),
      body.provider,
      JSON.stringify(body.config || {}),
      body.is_default === false ? 0 : 1,
      body.active === false ? 0 : 1,
      Date.now()
    )
    .run();

  return c.json({ id: Number(res.meta.last_row_id) }, 201);
});

app.put('/api/notifications/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{
    name: string;
    provider: string;
    config: Record<string, string>;
    is_default?: boolean;
    active?: boolean;
  }>();

  await c.env.uf_db.prepare(
    `UPDATE notification_channels
     SET name = ?, provider = ?, config = ?, is_default = ?, active = ?
     WHERE id = ?`
  )
    .bind(
      body.name.trim(),
      body.provider,
      JSON.stringify(body.config || {}),
      body.is_default === false ? 0 : 1,
      body.active === false ? 0 : 1,
      id
    )
    .run();

  return c.json({ updated: true });
});

app.delete('/api/notifications/:id', async (c) => {
  const id = Number(c.req.param('id'));
  await c.env.uf_db.prepare('DELETE FROM notification_channels WHERE id = ?').bind(id).run();
  return c.json({ deleted: true });
});

app.post('/api/notifications/test', async (c) => {
  const body = await c.req.json<{
    name?: string;
    provider: NotificationChannelRow['provider'];
    config: Record<string, string>;
  }>();

  const mockChannel: NotificationChannelRow = {
    id: 0,
    name: body.name || 'Test Channel',
    provider: body.provider,
    config: JSON.stringify(body.config || {}),
    is_default: 1,
    active: 1,
    created_at: Date.now(),
  };

  const result = await dispatchChannelAlert(
    mockChannel,
    {
      monitor: {
        id: 0,
        name: 'Cloudflare Edge Test Monitor',
        type: 'http',
        url_or_host: 'https://1.1.1.1',
        group_name: 'Core Infrastructure',
      },
      event: 'test',
      result: {
        status: 'up',
        latency_ms: 14,
        status_code: 200,
        message: 'Test notification triggered from UptimeFlare Dashboard',
      },
      timestamp: Date.now(),
    },
    c.env
  );

  if (!result.ok) {
    return c.json({ ok: false, error: result.error }, 400);
  }
  return c.json({ ok: true });
});

// ============================================================================
// 4. SETTINGS, BACKUP (EXPORT/IMPORT) & MANUAL CRON TRIGGER
// ============================================================================

app.put('/api/settings', async (c) => {
  const body = await c.req.json<Record<string, string>>();
  const allowedKeys = [
    'site_title',
    'site_description',
    'public_status_enabled',
    'public_announcement',
    'public_announcement_type',
    'retention_days',
    'cf_access_team_domain',
    'cf_access_aud',
  ];

  const statements = [];
  for (const key of allowedKeys) {
    if (body[key] !== undefined) {
      statements.push(
        c.env.uf_db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(
          key,
          String(body[key])
        )
      );
    }
  }
  if (statements.length > 0) {
    await c.env.uf_db.batch(statements);
    invalidateSettingsCache();
  }

  const updated = await getSettingsMap(c.env.uf_db, true);
  return c.json({ settings: updated });
});

app.get('/api/backup/export', async (c) => {
  const [monitors, channels, settings] = await Promise.all([
    c.env.uf_db.prepare('SELECT * FROM monitors ORDER BY id ASC').all<MonitorRow>(),
    c.env.uf_db.prepare('SELECT * FROM notification_channels ORDER BY id ASC').all<NotificationChannelRow>(),
    getSettingsMap(c.env.uf_db),
  ]);

  return c.json({
    version: '1.1.1',
    exported_at: new Date().toISOString(),
    settings,
    monitors: monitors.results || [],
    notification_channels: channels.results || [],
  });
});

app.post('/api/backup/import', async (c) => {
  const payload = await c.req.json<{
    settings?: Record<string, string>;
    monitors?: Array<Partial<MonitorRow>>;
    notification_channels?: Array<Partial<NotificationChannelRow>>;
  }>();

  const now = Date.now();
  let importedMonitors = 0;
  let importedChannels = 0;

  if (payload.settings) {
    const stmts = Object.entries(payload.settings).map(([k, v]) =>
      c.env.uf_db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(
        k,
        String(v)
      )
    );
    if (stmts.length > 0) {
      await c.env.uf_db.batch(stmts);
      invalidateSettingsCache();
    }
  }

  if (Array.isArray(payload.notification_channels)) {
    for (const ch of payload.notification_channels) {
      if (!ch.name || !ch.provider) continue;
      await c.env.uf_db.prepare(
        `INSERT INTO notification_channels (name, provider, config, is_default, active, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(
          ch.name,
          ch.provider,
          typeof ch.config === 'string' ? ch.config : JSON.stringify(ch.config || {}),
          ch.is_default ?? 1,
          ch.active ?? 1,
          now
        )
        .run();
      importedChannels++;
    }
  }

  if (Array.isArray(payload.monitors)) {
    for (const m of payload.monitors) {
      if (!m.name || !m.url_or_host) continue;
      const type = m.type || 'http';
      await c.env.uf_db.prepare(
        `INSERT INTO monitors (
          name, group_name, tags, type, url_or_host, port, method, headers, body,
          timeout_ms, interval_seconds, max_retries, expected_status, follow_redirects,
          ignore_tls, keyword, keyword_inverted, json_path, json_expected, json_operator,
          dns_record_type, dns_expected, push_token, active, is_public, current_status,
          consecutive_failures, notification_ids, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`
      )
        .bind(
          m.name,
          m.group_name || 'Core Infrastructure',
          typeof m.tags === 'string' ? m.tags : JSON.stringify(m.tags || []),
          type,
          m.url_or_host,
          m.port ?? null,
          m.method || 'GET',
          typeof m.headers === 'string' ? m.headers : JSON.stringify(m.headers || {}),
          m.body || '',
          m.timeout_ms || 10000,
          m.interval_seconds || 60,
          m.max_retries ?? 2,
          m.expected_status || '200-299',
          m.follow_redirects ?? 1,
          m.ignore_tls ?? 0,
          m.keyword ?? null,
          m.keyword_inverted ?? 0,
          m.json_path ?? null,
          m.json_expected ?? null,
          m.json_operator || '==',
          m.dns_record_type || 'A',
          m.dns_expected ?? null,
          type === 'push' ? generatePushToken() : null,
          m.active ?? 1,
          m.is_public ?? 1,
          typeof m.notification_ids === 'string'
            ? m.notification_ids
            : JSON.stringify(m.notification_ids || []),
          now,
          now
        )
        .run();
      importedMonitors++;
    }
    invalidateAggregateStatsCache();
  }

  return c.json({
    ok: true,
    imported_monitors: importedMonitors,
    imported_channels: importedChannels,
  });
});

app.post('/api/cron/run', async (c) => {
  const summary = await runScheduledChecks(c.env.uf_db, {
    forceAll: true,
    notifierEnv: c.env,
  });
  invalidateAggregateStatsCache();
  return c.json(summary);
});

// Fallback to Cloudflare Workers Static Assets for SPA routes
app.all('*', async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text('UptimeFlare Worker is running. Build client assets with `npm run build`.', 200);
});

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (!env.uf_db) return;
    ctx.waitUntil(
      (async () => {
        await ensureSchema(env.uf_db);
        await runScheduledChecks(env.uf_db, { notifierEnv: env });
      })()
    );
  },
};
