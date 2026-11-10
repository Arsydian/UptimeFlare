import { executeMonitorCheck } from './checker';
import { notifyMonitorTransition } from './notifier';
import { CheckResult, IncidentRow, MonitorRow, MonitorStatus } from './types';

/**
 * Evaluates a single monitor, records its heartbeat, manages consecutive retries
 * and incident lifecycle, and sends notifications on UP <-> DOWN transitions.
 */
export async function processSingleMonitorCheck(
  db: D1Database,
  monitor: MonitorRow,
  overrideResult?: CheckResult
): Promise<{
  monitorId: number;
  previousStatus: MonitorStatus;
  newStatus: MonitorStatus;
  result: CheckResult;
}> {
  const result = overrideResult || (await executeMonitorCheck(monitor));
  const now = Date.now();
  const prevStatus = monitor.current_status;
  const maxRetries = Math.max(0, monitor.max_retries ?? 2);

  let consecutiveFailures = monitor.consecutive_failures || 0;
  let newStatus: MonitorStatus = 'up';
  let heartbeatStatus: 'up' | 'down' | 'degraded' = 'up';

  if (result.status === 'up') {
    consecutiveFailures = 0;
    newStatus = 'up';
    heartbeatStatus = 'up';
  } else {
    consecutiveFailures += 1;
    // If maxRetries > 0 and we haven't crossed the threshold yet (and weren't already down), mark degraded
    if (consecutiveFailures <= maxRetries && prevStatus !== 'down') {
      newStatus = 'degraded';
      heartbeatStatus = 'degraded';
    } else {
      newStatus = 'down';
      heartbeatStatus = 'down';
    }
  }

  // Batch heartbeat insert + monitor state update in a single D1 round-trip
  await db.batch([
    db
      .prepare(
        `INSERT INTO heartbeats (monitor_id, status, latency_ms, status_code, message, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        monitor.id,
        heartbeatStatus,
        result.latency_ms,
        result.status_code,
        result.message,
        now
      ),
    db
      .prepare(
        `UPDATE monitors
         SET current_status = ?, consecutive_failures = ?, last_checked_at = ?, last_latency_ms = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(newStatus, consecutiveFailures, now, result.latency_ms, now, monitor.id),
  ]);

  // Incident & Notification state machine
  if (newStatus === 'down' && prevStatus !== 'down') {
    // Open a new incident if none is currently unresolved
    const openIncident = await db
      .prepare('SELECT * FROM incidents WHERE monitor_id = ? AND resolved_at IS NULL ORDER BY started_at DESC LIMIT 1')
      .bind(monitor.id)
      .first<IncidentRow>();

    if (!openIncident) {
      await db
        .prepare('INSERT INTO incidents (monitor_id, started_at, cause) VALUES (?, ?, ?)')
        .bind(monitor.id, now, result.message)
        .run();
    }

    await notifyMonitorTransition(db, monitor, 'down', result);
  } else if (newStatus === 'up' && prevStatus === 'down') {
    // Resolve open incident
    const openIncident = await db
      .prepare('SELECT * FROM incidents WHERE monitor_id = ? AND resolved_at IS NULL ORDER BY started_at DESC LIMIT 1')
      .bind(monitor.id)
      .first<IncidentRow>();

    let downtimeSeconds = 0;
    if (openIncident) {
      downtimeSeconds = Math.max(1, Math.round((now - openIncident.started_at) / 1000));
      await db
        .prepare('UPDATE incidents SET resolved_at = ? WHERE id = ?')
        .bind(now, openIncident.id)
        .run();
    }

    await notifyMonitorTransition(db, monitor, 'up', result, downtimeSeconds);
  }

  return {
    monitorId: monitor.id,
    previousStatus: prevStatus,
    newStatus,
    result,
  };
}

/**
 * Executes all monitors whose check interval has elapsed.
 * Caps checks per cron tick to 35 to stay safely within the Cloudflare Workers Free Tier 50-subrequest limit.
 */
export async function runScheduledChecks(
  db: D1Database,
  options?: { forceAll?: boolean }
): Promise<{
  checkedCount: number;
  results: Array<{ monitorId: number; newStatus: MonitorStatus; latencyMs: number }>;
}> {
  const now = Date.now();
  const forceAll = options?.forceAll === true;

  const { results: activeMonitors } = await db
    .prepare('SELECT * FROM monitors WHERE active = 1 ORDER BY COALESCE(last_checked_at, 0) ASC')
    .all<MonitorRow>();

  if (!activeMonitors || activeMonitors.length === 0) {
    return { checkedCount: 0, results: [] };
  }

  // When forceAll is true (manual "Check All" button), check all active non-push monitors immediately
  // regardless of how much time remains before their next scheduled check.
  const targetMonitors = forceAll
    ? activeMonitors.filter((m) => m.type !== 'push')
    : activeMonitors.filter((m) => {
        if (!m.last_checked_at) return true;
        const intervalMs = Math.max(m.interval_seconds || 60, 30) * 1000;
        return now - m.last_checked_at >= intervalMs - 5000;
      });

  // Cap at 35 monitors per invocation to respect Cloudflare Free Tier 50-subrequest limit
  const batchToCheck = targetMonitors.slice(0, 35);

  const checkOutcomes = await Promise.allSettled(
    batchToCheck.map((m) => processSingleMonitorCheck(db, m))
  );

  const summary: Array<{ monitorId: number; newStatus: MonitorStatus; latencyMs: number }> = [];
  for (const outcome of checkOutcomes) {
    if (outcome.status === 'fulfilled') {
      summary.push({
        monitorId: outcome.value.monitorId,
        newStatus: outcome.value.newStatus,
        latencyMs: outcome.value.result.latency_ms,
      });
    }
  }

  // Run D1 retention cleanup at most once every 6 hours
  try {
    await maybeRunRetentionCleanup(db, now);
  } catch {
    // Non-fatal cleanup error
  }

  return { checkedCount: summary.length, results: summary };
}

async function maybeRunRetentionCleanup(db: D1Database, now: number): Promise<void> {
  const { results: settingsRows } = await db
    .prepare("SELECT key, value FROM settings WHERE key IN ('retention_days', 'last_cleanup_at')")
    .all<{ key: string; value: string }>();

  const map = new Map<string, string>();
  for (const row of settingsRows || []) {
    map.set(row.key, row.value);
  }

  const lastCleanup = Number(map.get('last_cleanup_at') || '0');
  const sixHoursMs = 6 * 60 * 60 * 1000;
  if (now - lastCleanup < sixHoursMs) {
    return;
  }

  const retentionDays = Math.max(1, Number(map.get('retention_days') || '30'));
  const cutoffTime = now - retentionDays * 24 * 60 * 60 * 1000;

  await db.batch([
    db.prepare('DELETE FROM heartbeats WHERE timestamp < ?').bind(cutoffTime),
    db
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_cleanup_at', ?)")
      .bind(String(now)),
  ]);
}
