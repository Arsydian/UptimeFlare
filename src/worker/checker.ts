import { CheckResult, MonitorRow } from './types';

/**
 * Evaluates whether a numeric HTTP status code matches an Uptime Kuma-style range string,
 * e.g. "200-299", "200, 201, 204", "200-299, 301-302".
 */
export function matchesStatusCode(statusCode: number, rangeSpec: string): boolean {
  const spec = (rangeSpec || '200-299').trim();
  const parts = spec.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    return statusCode >= 200 && statusCode <= 299;
  }

  for (const part of parts) {
    if (part.includes('-')) {
      const [minStr, maxStr] = part.split('-').map((s) => s.trim());
      const min = Number(minStr);
      const max = Number(maxStr);
      if (!Number.isNaN(min) && !Number.isNaN(max) && statusCode >= min && statusCode <= max) {
        return true;
      }
    } else {
      const exact = Number(part);
      if (!Number.isNaN(exact) && statusCode === exact) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Resolves a dot/bracket path against a parsed JSON value, e.g. "data.items[0].status"
 */
export function evaluateJsonPath(obj: unknown, pathSpec: string): unknown {
  if (!pathSpec || pathSpec.trim() === '' || pathSpec.trim() === '$') {
    return obj;
  }
  const normalized = pathSpec
    .trim()
    .replace(/^\$\.?/, '')
    .replace(/\[(\d+)\]/g, '.$1');

  const segments = normalized.split('.').filter(Boolean);
  let current: unknown = obj;

  for (const seg of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return current;
}

export function compareJsonValue(actual: unknown, operator: string, expectedRaw: string | null): boolean {
  const expected = expectedRaw ?? '';
  if (actual === undefined) return false;

  const actualStr = typeof actual === 'object' ? JSON.stringify(actual) : String(actual);
  const op = (operator || '==').trim();

  switch (op) {
    case '==':
    case '=':
      return actualStr === expected || (typeof actual === 'boolean' && String(actual) === expected.toLowerCase());
    case '!=':
      return actualStr !== expected;
    case 'contains':
      return actualStr.toLowerCase().includes(expected.toLowerCase());
    case '>':
      return Number(actual) > Number(expected);
    case '>=':
      return Number(actual) >= Number(expected);
    case '<':
      return Number(actual) < Number(expected);
    case '<=':
      return Number(actual) <= Number(expected);
    default:
      return actualStr === expected;
  }
}

/**
 * Executes an HTTP, Keyword, or JSON-Query check using Cloudflare Edge fetch
 */
async function checkHttpMonitor(monitor: MonitorRow): Promise<CheckResult> {
  const start = Date.now();
  const timeoutMs = Math.min(Math.max(monitor.timeout_ms || 10000, 1000), 30000);

  let targetUrl = monitor.url_or_host.trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = `https://${targetUrl}`;
  }

  let customHeaders: Record<string, string> = {};
  try {
    if (monitor.headers && monitor.headers.trim()) {
      customHeaders = JSON.parse(monitor.headers);
    }
  } catch {
    customHeaders = {};
  }

  const headers = new Headers({
    'User-Agent': 'UptimeFlare-Monitor/1.0 (+https://cloudflare.com)',
    Accept: '*/*',
    ...customHeaders,
  });

  const method = (monitor.method || 'GET').toUpperCase();
  const init: RequestInit = {
    method,
    headers,
    redirect: monitor.follow_redirects === 0 ? 'manual' : 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  };

  if (method !== 'GET' && method !== 'HEAD' && monitor.body) {
    init.body = monitor.body;
  }

  try {
    const response = await fetch(targetUrl, init);
    const latency = Math.max(1, Date.now() - start);
    const statusCode = response.status;

    const statusOk = matchesStatusCode(statusCode, monitor.expected_status || '200-299');
    if (!statusOk) {
      return {
        status: 'down',
        latency_ms: latency,
        status_code: statusCode,
        message: `Unexpected HTTP ${statusCode} (expected ${monitor.expected_status || '200-299'})`,
      };
    }

    if (monitor.type === 'keyword' && monitor.keyword) {
      const bodyText = await response.text();
      const found = bodyText.includes(monitor.keyword);
      const inverted = monitor.keyword_inverted === 1;

      if (inverted && found) {
        return {
          status: 'down',
          latency_ms: latency,
          status_code: statusCode,
          message: `Forbidden keyword "${monitor.keyword}" found in response`,
        };
      }
      if (!inverted && !found) {
        return {
          status: 'down',
          latency_ms: latency,
          status_code: statusCode,
          message: `Keyword "${monitor.keyword}" missing from response`,
        };
      }
      return {
        status: 'up',
        latency_ms: latency,
        status_code: statusCode,
        message: `${statusCode} OK • Keyword verified`,
      };
    }

    if (monitor.type === 'json-query' && monitor.json_path) {
      let jsonData: unknown;
      try {
        jsonData = await response.json();
      } catch {
        return {
          status: 'down',
          latency_ms: latency,
          status_code: statusCode,
          message: 'Response is not valid JSON',
        };
      }

      const actualVal = evaluateJsonPath(jsonData, monitor.json_path);
      const matched = compareJsonValue(actualVal, monitor.json_operator || '==', monitor.json_expected);

      if (!matched) {
        return {
          status: 'down',
          latency_ms: latency,
          status_code: statusCode,
          message: `JSON path "${monitor.json_path}" returned "${String(actualVal)}" (expected ${monitor.json_operator || '=='} "${monitor.json_expected ?? ''}")`,
        };
      }

      return {
        status: 'up',
        latency_ms: latency,
        status_code: statusCode,
        message: `${statusCode} OK • JSON ${monitor.json_path}=${String(actualVal)}`,
      };
    }

    return {
      status: 'up',
      latency_ms: latency,
      status_code: statusCode,
      message: `${statusCode} ${response.statusText || 'OK'}`,
    };
  } catch (err) {
    const latency = Math.max(1, Date.now() - start);
    const errMsg = err instanceof Error ? err.message : 'Request failed';
    return {
      status: 'down',
      latency_ms: latency,
      status_code: null,
      message: errMsg.includes('timed out') || errMsg.includes('Timeout')
        ? `Connection timed out after ${timeoutMs}ms`
        : errMsg,
    };
  }
}

/**
 * Executes a TCP Port check using Cloudflare Workers runtime `cloudflare:sockets`
 */
async function checkTcpMonitor(monitor: MonitorRow): Promise<CheckResult> {
  const start = Date.now();
  const timeoutMs = Math.min(Math.max(monitor.timeout_ms || 8000, 1000), 25000);
  const host = monitor.url_or_host.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
  const port = monitor.port || 443;

  try {
    const socketsModule = (await import('cloudflare:sockets')) as {
      connect: (address: { hostname: string; port: number }) => {
        opened: Promise<unknown>;
        close: () => Promise<void> | void;
      };
    };

    const socket = socketsModule.connect({ hostname: host, port });

    await Promise.race([
      socket.opened,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`TCP handshake timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);

    const latency = Math.max(1, Date.now() - start);
    try {
      await socket.close();
    } catch {
      // Ignore close errors
    }

    return {
      status: 'up',
      latency_ms: latency,
      status_code: null,
      message: `TCP ${host}:${port} connected (${latency}ms)`,
    };
  } catch (err) {
    const latency = Math.max(1, Date.now() - start);
    const message = err instanceof Error ? err.message : `TCP connect failed to ${host}:${port}`;
    return {
      status: 'down',
      latency_ms: latency,
      status_code: null,
      message,
    };
  }
}

/**
 * Executes a DNS Record check using Cloudflare DNS-over-HTTPS (1.1.1.1)
 */
async function checkDnsMonitor(monitor: MonitorRow): Promise<CheckResult> {
  const start = Date.now();
  const timeoutMs = Math.min(Math.max(monitor.timeout_ms || 8000, 1000), 20000);
  const domain = monitor.url_or_host.replace(/^https?:\/\//i, '').split('/')[0].trim();
  const recordType = (monitor.dns_record_type || 'A').toUpperCase();

  try {
    const dohUrl = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${encodeURIComponent(recordType)}`;
    const response = await fetch(dohUrl, {
      headers: { Accept: 'application/dns-json' },
      signal: AbortSignal.timeout(timeoutMs),
    });

    const latency = Math.max(1, Date.now() - start);
    if (!response.ok) {
      return {
        status: 'down',
        latency_ms: latency,
        status_code: response.status,
        message: `DoH resolver returned HTTP ${response.status}`,
      };
    }

    const data = (await response.json()) as {
      Status: number;
      Answer?: Array<{ name: string; type: number; TTL: number; data: string }>;
    };

    if (data.Status !== 0 || !data.Answer || data.Answer.length === 0) {
      return {
        status: 'down',
        latency_ms: latency,
        status_code: data.Status,
        message: `DNS ${recordType} lookup returned no answers (RCODE ${data.Status})`,
      };
    }

    const answers = data.Answer.map((a) => a.data.replace(/^"|"$/g, ''));
    if (monitor.dns_expected && monitor.dns_expected.trim()) {
      const expected = monitor.dns_expected.trim().toLowerCase();
      const matched = answers.some((ans) => ans.toLowerCase().includes(expected));
      if (!matched) {
        return {
          status: 'down',
          latency_ms: latency,
          status_code: 0,
          message: `DNS ${recordType} resolved [${answers.join(', ')}], expected "${monitor.dns_expected}"`,
        };
      }
    }

    return {
      status: 'up',
      latency_ms: latency,
      status_code: 0,
      message: `DNS ${recordType}: ${answers[0]}${answers.length > 1 ? ` (+${answers.length - 1})` : ''}`,
    };
  } catch (err) {
    const latency = Math.max(1, Date.now() - start);
    return {
      status: 'down',
      latency_ms: latency,
      status_code: null,
      message: err instanceof Error ? err.message : 'DNS lookup failed',
    };
  }
}

/**
 * Evaluates a monitor according to its configured type
 */
export async function executeMonitorCheck(monitor: MonitorRow): Promise<CheckResult> {
  switch (monitor.type) {
    case 'http':
    case 'keyword':
    case 'json-query':
      return checkHttpMonitor(monitor);
    case 'tcp':
      return checkTcpMonitor(monitor);
    case 'dns':
      return checkDnsMonitor(monitor);
    case 'push': {
      // For Push monitors, active probing checks whether the last inbound push is still fresh
      const now = Date.now();
      const intervalMs = Math.max(monitor.interval_seconds || 60, 30) * 1000;
      const graceMs = Math.max(Math.floor(intervalMs * 0.5), 30000);
      if (!monitor.last_checked_at) {
        return {
          status: 'down',
          latency_ms: 0,
          status_code: null,
          message: 'Awaiting initial inbound heartbeat push',
        };
      }
      const elapsed = now - monitor.last_checked_at;
      if (elapsed > intervalMs + graceMs) {
        return {
          status: 'down',
          latency_ms: 0,
          status_code: null,
          message: `No heartbeat push received for ${Math.round(elapsed / 1000)}s (limit ${Math.round((intervalMs + graceMs) / 1000)}s)`,
        };
      }
      return {
        status: 'up',
        latency_ms: monitor.last_latency_ms ?? 1,
        status_code: 200,
        message: `Heartbeat active (last push ${Math.round(elapsed / 1000)}s ago)`,
      };
    }
    default:
      return checkHttpMonitor(monitor);
  }
}
