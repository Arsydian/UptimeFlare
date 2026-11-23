import { describe, expect, it } from 'vitest';
import { AlertEvent, dispatchChannelAlert, normalizePostletSendUrl } from '../src/worker/notifier';
import { NotificationChannelRow } from '../src/worker/types';

function makeAlert(overrides?: Partial<AlertEvent['monitor']>): AlertEvent {
  return {
    monitor: {
      id: 42,
      name: 'Core API <prod> & Edge',
      type: 'http',
      url_or_host: 'https://api.example.com/health',
      group_name: 'Production & Core',
      ...overrides,
    },
    event: 'down',
    result: {
      status: 'down',
      latency_ms: 812,
      status_code: 503,
      message: 'Expected 200-299, got 503 <Upstream>',
    },
    timestamp: Date.UTC(2026, 10, 23, 14, 0, 0),
  };
}

function makePostletChannel(config: Record<string, string>): NotificationChannelRow {
  return {
    id: 7,
    name: 'Postlet Ops Email',
    provider: 'postlet',
    config: JSON.stringify(config),
    is_default: 1,
    active: 1,
    created_at: Date.UTC(2026, 10, 23, 14, 0, 0),
  };
}

describe('Postlet Notification Provider & Service Auth', () => {
  it('normalizes Postlet base URLs cleanly', () => {
    expect(normalizePostletSendUrl('https://mail.example.com/')).toBe(
      'https://mail.example.com/api/v1/messages/send'
    );
    expect(normalizePostletSendUrl('https://mail.example.com/api/v1/')).toBe(
      'https://mail.example.com/api/v1/messages/send'
    );
    expect(normalizePostletSendUrl('https://mail.example.com/api/v1/messages/send')).toBe(
      'https://mail.example.com/api/v1/messages/send'
    );
  });

  it('sends alerts to Postlet /api/v1/messages/send using Worker secrets & Service Auth headers', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const mockFetch: typeof fetch = async (input, init) => {
      calls.push({ url: typeof input === 'string' ? input : input.toString(), init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const channel = makePostletChannel({
      to_email: 'Ops <ops@example.com>, admin@example.org',
    });

    const outcome = await dispatchChannelAlert(
      channel,
      makeAlert(),
      {
        POSTLET_API_URL: 'https://mail.example.com/',
        POSTLET_API_KEY: 'plt_worker_secret_123456',
        POSTLET_FROM_EMAIL: 'UptimeFlare Alerts <uptime@example.com>',
        CF_ACCESS_CLIENT_ID: 'svc-client-id.access',
        CF_ACCESS_CLIENT_SECRET: 'svc-client-secret-xyz',
        POSTLET_SERVICE_AUTH_SECRET: 'shared-hmac-secret',
      },
      mockFetch
    );

    expect(outcome).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://mail.example.com/api/v1/messages/send');
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.redirect).toBe('manual');

    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer plt_worker_secret_123456');
    expect(headers.get('CF-Access-Client-Id')).toBe('svc-client-id.access');
    expect(headers.get('CF-Access-Client-Secret')).toBe('svc-client-secret-xyz');
    expect(headers.get('X-Postlet-Service-Secret')).toBe('shared-hmac-secret');

    const body = JSON.parse(String(calls[0].init?.body || '{}')) as {
      fromAddress?: string;
      to: string[];
      subject: string;
      textBody: string;
      htmlBody: string;
    };
    expect(body.fromAddress).toBe('uptime@example.com');
    expect(body.to).toEqual(['ops@example.com', 'admin@example.org']);
    expect(body.subject).toContain('[UptimeFlare]');
    expect(body.subject).toContain('Core API <prod> & Edge');
    expect(body.textBody).toContain('MONITOR DOWN');
    expect(body.htmlBody).toContain('Core API &lt;prod&gt; &amp; Edge');
    expect(body.htmlBody).toContain('Production &amp; Core');
  });

  it('prefers channel-level config overrides over env vars', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const mockFetch: typeof fetch = async (input, init) => {
      calls.push({ url: typeof input === 'string' ? input : input.toString(), init });
      return new Response('{}', { status: 200 });
    };

    const channel = makePostletChannel({
      api_url: 'https://custom.postlet.example/api/v1',
      api_key: 'plt_channel_override',
      cf_access_client_id: 'channel-id.access',
      cf_access_client_secret: 'channel-secret',
      service_auth_secret: 'channel-shared-secret',
      to_email: 'alerts@example.org',
    });

    const res = await dispatchChannelAlert(
      channel,
      makeAlert(),
      {
        POSTLET_API_URL: 'https://mail.example.com',
        POSTLET_API_KEY: 'plt_env_key',
        POSTLET_CF_ACCESS_CLIENT_ID: 'env-id.access',
        POSTLET_CF_ACCESS_CLIENT_SECRET: 'env-secret',
        POSTLET_SERVICE_AUTH_SECRET: 'env-shared-secret',
      },
      mockFetch
    );

    expect(res).toEqual({ ok: true });
    expect(calls[0].url).toBe('https://custom.postlet.example/api/v1/messages/send');
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer plt_channel_override');
    expect(headers.get('CF-Access-Client-Id')).toBe('channel-id.access');
    expect(headers.get('CF-Access-Client-Secret')).toBe('channel-secret');
    expect(headers.get('X-Postlet-Service-Secret')).toBe('channel-shared-secret');
  });

  it('surfaces actionable diagnostics for Cloudflare Access redirects, HTML responses, and API JSON errors', async () => {
    const channel = makePostletChannel({ to_email: 'ops@example.org' });
    const envCfg = {
      POSTLET_API_URL: 'https://mail.example.com',
      POSTLET_API_KEY: 'plt_key',
    };

    const redirectRes = await dispatchChannelAlert(
      channel,
      makeAlert(),
      envCfg,
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login' },
        })
    );
    expect(redirectRes.ok).toBe(false);
    expect(redirectRes.error).toContain('Cloudflare Access redirect');

    const htmlRes = await dispatchChannelAlert(
      channel,
      makeAlert(),
      envCfg,
      async () =>
        new Response('<html><body>Access Denied</body></html>', {
          status: 403,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
    );
    expect(htmlRes.ok).toBe(false);
    expect(htmlRes.error).toContain('Cloudflare Access Service Auth');

    const jsonErrRes = await dispatchChannelAlert(
      channel,
      makeAlert(),
      envCfg,
      async () =>
        new Response(JSON.stringify({ error: 'Invalid or missing X-Postlet-Service-Secret header' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    expect(jsonErrRes.ok).toBe(false);
    expect(jsonErrRes.error).toBe(
      'Postlet API HTTP 401: Invalid or missing X-Postlet-Service-Secret header'
    );
  });

  it('validates required Postlet URL, API key, and recipients before calling fetch', async () => {
    let called = false;
    const noFetch: typeof fetch = async () => {
      called = true;
      return new Response('{}', { status: 200 });
    };

    const missingUrl = await dispatchChannelAlert(
      makePostletChannel({ to_email: 'ops@example.org' }),
      makeAlert(),
      { POSTLET_API_KEY: 'plt_k' },
      noFetch
    );
    expect(missingUrl.ok).toBe(false);
    expect(missingUrl.error).toContain('Missing Postlet Base URL');

    const missingKey = await dispatchChannelAlert(
      makePostletChannel({ to_email: 'ops@example.org' }),
      makeAlert(),
      { POSTLET_API_URL: 'https://mail.example.com' },
      noFetch
    );
    expect(missingKey.ok).toBe(false);
    expect(missingKey.error).toContain('Missing Postlet Agent API key');

    const missingTo = await dispatchChannelAlert(
      makePostletChannel({}),
      makeAlert(),
      { POSTLET_API_URL: 'https://mail.example.com', POSTLET_API_KEY: 'plt_k' },
      noFetch
    );
    expect(missingTo.ok).toBe(false);
    expect(missingTo.error).toContain('Missing recipient To email address');
    expect(called).toBe(false);
  });
});
