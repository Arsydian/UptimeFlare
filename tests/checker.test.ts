import { describe, expect, it } from 'vitest';
import { compareJsonValue, evaluateJsonPath, executeMonitorCheck, matchesStatusCode } from '../src/worker/checker';
import { computeTimeBasedTheme } from '../src/client/hooks/useTheme';
import { MonitorRow } from '../src/worker/types';

describe('UptimeFlare Monitor Check Utilities', () => {
  it('validates Uptime Kuma-style HTTP status code ranges', () => {
    expect(matchesStatusCode(200, '200-299')).toBe(true);
    expect(matchesStatusCode(204, '200-299')).toBe(true);
    expect(matchesStatusCode(404, '200-299')).toBe(false);
    expect(matchesStatusCode(301, '200-299, 301, 401')).toBe(true);
    expect(matchesStatusCode(500, '200-299, 301, 401')).toBe(false);
  });

  it('resolves nested JSON paths with dot and array bracket notation', () => {
    const sample = {
      status: { healthy: true, code: 200 },
      data: { nodes: [{ region: 'sfo', latency: 12 }] },
    };

    expect(evaluateJsonPath(sample, 'status.healthy')).toBe(true);
    expect(evaluateJsonPath(sample, '$.data.nodes[0].region')).toBe('sfo');
    expect(evaluateJsonPath(sample, 'data.nodes.0.latency')).toBe(12);
    expect(evaluateJsonPath(sample, 'missing.field')).toBeUndefined();
  });

  it('compares JSON path values across operators', () => {
    expect(compareJsonValue(true, '==', 'true')).toBe(true);
    expect(compareJsonValue('operational', 'contains', 'oper')).toBe(true);
    expect(compareJsonValue(18, '<', '50')).toBe(true);
    expect(compareJsonValue(120, '<', '50')).toBe(false);
    expect(compareJsonValue('error', '!=', 'ok')).toBe(true);
  });

  it('evaluates Push monitor freshness and expiration accurately', async () => {
    const now = Date.now();
    const basePushMonitor: MonitorRow = {
      id: 1,
      name: 'Backup Cron Push',
      group_name: 'Jobs',
      tags: '[]',
      type: 'push',
      url_or_host: 'backup-job',
      port: null,
      method: 'GET',
      headers: '{}',
      body: '',
      timeout_ms: 5000,
      interval_seconds: 60,
      max_retries: 1,
      expected_status: '200-299',
      follow_redirects: 1,
      ignore_tls: 0,
      keyword: null,
      keyword_inverted: 0,
      json_path: null,
      json_expected: null,
      json_operator: '==',
      dns_record_type: 'A',
      dns_expected: null,
      push_token: 'abc123token',
      active: 1,
      is_public: 1,
      current_status: 'up',
      consecutive_failures: 0,
      last_checked_at: now - 15000, // 15s ago
      last_latency_ms: 9,
      notification_ids: '[]',
      created_at: now,
      updated_at: now,
    };

    const freshRes = await executeMonitorCheck(basePushMonitor);
    expect(freshRes.status).toBe('up');
    expect(freshRes.latency_ms).toBe(9);

    const staleRes = await executeMonitorCheck({
      ...basePushMonitor,
      last_checked_at: now - 180000, // 3 minutes ago (exceeds 60s + 30s grace)
    });
    expect(staleRes.status).toBe('down');
  });

  it('computes local time-based theme (6am-6:59pm Light, 7pm-5:59am Dark)', () => {
    const morning = new Date(2026, 10, 9, 9, 30, 0);
    const afternoon = new Date(2026, 10, 9, 18, 45, 0);
    const evening = new Date(2026, 10, 9, 19, 15, 0);
    const lateNight = new Date(2026, 10, 9, 2, 10, 0);

    expect(computeTimeBasedTheme(morning)).toBe('light');
    expect(computeTimeBasedTheme(afternoon)).toBe('light');
    expect(computeTimeBasedTheme(evening)).toBe('dark');
    expect(computeTimeBasedTheme(lateNight)).toBe('dark');
  });
});
