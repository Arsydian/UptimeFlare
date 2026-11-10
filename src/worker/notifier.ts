import { CheckResult, MonitorRow, NotificationChannelRow } from './types';

export interface AlertEvent {
  monitor: {
    id: number;
    name: string;
    type: string;
    url_or_host: string;
    group_name: string;
  };
  event: 'down' | 'up' | 'test';
  result: CheckResult;
  downtimeSeconds?: number;
  timestamp: number;
}

function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return '0s';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const parts: string[] = [];
  if (hrs > 0) parts.push(`${hrs}h`);
  if (mins > 0) parts.push(`${mins}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  return parts.join(' ');
}

function toBase64Utf8(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function extractEmailAddress(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim();
}

async function sendSmtpEmail(options: {
  host: string;
  port: number;
  security: 'tls' | 'starttls' | 'none';
  username?: string;
  password?: string;
  from: string;
  to: string[];
  subject: string;
  bodyText: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (options.port === 25) {
    return {
      ok: false,
      error:
        'Cloudflare Workers blocks outbound TCP port 25. Use port 465 (SSL/TLS) or port 587 / 2525 (STARTTLS).',
    };
  }

  const { connect } = await import('cloudflare:sockets');
  const secureTransport: 'on' | 'off' | 'starttls' =
    options.security === 'tls'
      ? 'on'
      : options.security === 'starttls'
        ? 'starttls'
        : 'off';

  let socket = connect(
    { hostname: options.host, port: options.port },
    { secureTransport, allowHalfOpen: false }
  );

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let reader = socket.readable.getReader();
  let writer = socket.writable.getWriter();
  let buffer = '';

  const readSmtpResponse = async (): Promise<{ code: number; text: string }> => {
    const lines: string[] = [];
    while (true) {
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx !== -1) {
        const line = buffer.slice(0, newlineIdx).replace(/\r$/, '');
        buffer = buffer.slice(newlineIdx + 1);
        lines.push(line);
        if (line.length >= 3 && (line.length === 3 || line[3] === ' ')) {
          const code = Number(line.slice(0, 3));
          return { code, text: lines.join('\n') };
        }
        continue;
      }

      const { value, done } = await reader.read();
      if (done) {
        const last = lines[lines.length - 1] || buffer;
        return {
          code: Number(last.slice(0, 3)) || 0,
          text: [...lines, buffer].filter(Boolean).join('\n'),
        };
      }
      buffer += decoder.decode(value, { stream: true });
    }
  };

  const sendCommand = async (cmd: string): Promise<{ code: number; text: string }> => {
    await writer.write(encoder.encode(`${cmd}\r\n`));
    return readSmtpResponse();
  };

  try {
    await socket.opened;
    const greeting = await readSmtpResponse();
    if (greeting.code !== 220) {
      return { ok: false, error: `SMTP greeting failed: ${greeting.text}` };
    }

    let ehlo = await sendCommand('EHLO uptimeflare.worker');
    if (ehlo.code !== 250) {
      ehlo = await sendCommand('HELO uptimeflare.worker');
      if (ehlo.code !== 250) {
        return { ok: false, error: `SMTP EHLO failed: ${ehlo.text}` };
      }
    }

    if (options.security === 'starttls') {
      const startTlsRes = await sendCommand('STARTTLS');
      if (startTlsRes.code !== 220) {
        return { ok: false, error: `SMTP STARTTLS failed: ${startTlsRes.text}` };
      }
      reader.releaseLock();
      writer.releaseLock();
      socket = socket.startTls();
      reader = socket.readable.getReader();
      writer = socket.writable.getWriter();
      buffer = '';

      const tlsEhlo = await sendCommand('EHLO uptimeflare.worker');
      if (tlsEhlo.code !== 250) {
        return { ok: false, error: `SMTP EHLO after STARTTLS failed: ${tlsEhlo.text}` };
      }
    }

    if (options.username && options.password) {
      const plainToken = toBase64Utf8(`\0${options.username}\0${options.password}`);
      const authPlain = await sendCommand(`AUTH PLAIN ${plainToken}`);
      if (authPlain.code !== 235) {
        // Fallback to AUTH LOGIN
        const authLogin = await sendCommand('AUTH LOGIN');
        if (authLogin.code === 334) {
          const userRes = await sendCommand(toBase64Utf8(options.username));
          if (userRes.code === 334) {
            const passRes = await sendCommand(toBase64Utf8(options.password));
            if (passRes.code !== 235) {
              return { ok: false, error: `SMTP AUTH LOGIN failed: ${passRes.text}` };
            }
          } else {
            return { ok: false, error: `SMTP AUTH username rejected: ${userRes.text}` };
          }
        } else {
          return { ok: false, error: `SMTP authentication failed: ${authPlain.text}` };
        }
      }
    }

    const fromAddr = extractEmailAddress(options.from);
    const mailFrom = await sendCommand(`MAIL FROM:<${fromAddr}>`);
    if (mailFrom.code !== 250) {
      return { ok: false, error: `SMTP MAIL FROM rejected: ${mailFrom.text}` };
    }

    for (const rcpt of options.to) {
      const rcptAddr = extractEmailAddress(rcpt);
      const rcptTo = await sendCommand(`RCPT TO:<${rcptAddr}>`);
      if (rcptTo.code !== 250 && rcptTo.code !== 251) {
        return { ok: false, error: `SMTP RCPT TO <${rcptAddr}> rejected: ${rcptTo.text}` };
      }
    }

    const dataCmd = await sendCommand('DATA');
    if (dataCmd.code !== 354) {
      return { ok: false, error: `SMTP DATA rejected: ${dataCmd.text}` };
    }

    const msgId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@uptimeflare.worker>`;
    const safeSubject = options.subject.replace(/[\r\n]+/g, ' ');
    const dotStuffedBody = options.bodyText
      .replace(/\r?\n/g, '\r\n')
      .replace(/^\./gm, '..');

    const rawEmail = [
      `From: ${options.from}`,
      `To: ${options.to.join(', ')}`,
      `Subject: =?UTF-8?B?${toBase64Utf8(safeSubject)}?=`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: ${msgId}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      dotStuffedBody,
      '.',
    ].join('\r\n');

    const dataDone = await sendCommand(rawEmail);
    if (dataDone.code !== 250) {
      return { ok: false, error: `SMTP message delivery failed: ${dataDone.text}` };
    }

    await sendCommand('QUIT').catch(() => null);
    return { ok: true };
  } finally {
    try {
      reader.releaseLock();
      writer.releaseLock();
      await socket.close();
    } catch {
      // Ignore socket close errors
    }
  }
}

export async function dispatchChannelAlert(
  channel: NotificationChannelRow,
  alert: AlertEvent
): Promise<{ ok: boolean; error?: string }> {
  let config: Record<string, string> = {};
  try {
    config = JSON.parse(channel.config || '{}');
  } catch {
    return { ok: false, error: 'Invalid channel configuration JSON' };
  }

  const isUp = alert.event === 'up';
  const isTest = alert.event === 'test';
  const badge = isTest ? '🔔 TEST ALERT' : isUp ? '🟢 RECOVERED (UP)' : '🔴 MONITOR DOWN';
  const title = `${badge}: ${alert.monitor.name}`;
  const timeIso = new Date(alert.timestamp).toISOString();

  const summaryLines = [
    `Monitor: ${alert.monitor.name} (${alert.monitor.type.toUpperCase()})`,
    `Target: ${alert.monitor.url_or_host}`,
    `Status: ${alert.event.toUpperCase()}`,
    `Reason: ${alert.result.message}`,
    `Latency: ${alert.result.latency_ms}ms`,
  ];
  if (isUp && alert.downtimeSeconds) {
    summaryLines.push(`Downtime Duration: ${formatDuration(alert.downtimeSeconds)}`);
  }
  summaryLines.push(`Time: ${timeIso}`);
  const plainText = `${title}\n${summaryLines.join('\n')}`;

  try {
    switch (channel.provider) {
      case 'smtp': {
        const host = (config.smtp_host || '').trim();
        const port = Number(config.smtp_port) || 587;
        const security = (config.smtp_security || (port === 465 ? 'tls' : 'starttls')) as
          | 'tls'
          | 'starttls'
          | 'none';
        const username = (config.smtp_user || '').trim();
        const password = config.smtp_pass || '';
        const from = (config.from_email || username || '').trim();
        const toList = (config.to_email || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

        if (!host || !from || toList.length === 0) {
          return {
            ok: false,
            error: 'Missing SMTP host, From email, or To email address',
          };
        }

        return await sendSmtpEmail({
          host,
          port,
          security,
          username: username || undefined,
          password: password || undefined,
          from,
          to: toList,
          subject: `[UptimeFlare] ${title}`,
          bodyText: plainText,
        });
      }

      case 'email': {
        const service = (config.email_service || 'resend').toLowerCase();
        const apiKey = (config.api_key || '').trim();
        const fromEmail = (config.from_email || '').trim();
        const toList = (config.to_email || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

        if (!apiKey || !fromEmail || toList.length === 0) {
          return {
            ok: false,
            error: 'Missing Email API key, From email, or To email address',
          };
        }

        if (service === 'sendgrid') {
          const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              personalizations: [{ to: toList.map((email) => ({ email })) }],
              from: { email: extractEmailAddress(fromEmail) },
              subject: `[UptimeFlare] ${title}`,
              content: [{ type: 'text/plain', value: plainText }],
            }),
          });
          if (!res.ok) return { ok: false, error: `SendGrid HTTP ${res.status}` };
          return { ok: true };
        }

        // Default: Resend HTTP API (https://api.resend.com/emails)
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: fromEmail,
            to: toList,
            subject: `[UptimeFlare] ${title}`,
            text: plainText,
          }),
        });
        if (!res.ok) return { ok: false, error: `Resend API HTTP ${res.status}` };
        return { ok: true };
      }

      case 'discord': {
        const webhookUrl = (config.webhook_url || '').trim();
        if (!webhookUrl) return { ok: false, error: 'Missing Discord webhook_url' };

        const color = isTest ? 0xf6821f : isUp ? 0x10b981 : 0xef4444;
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: 'UptimeFlare',
            embeds: [
              {
                title,
                description: alert.result.message,
                color,
                fields: [
                  { name: 'Target', value: `\`${alert.monitor.url_or_host}\``, inline: true },
                  { name: 'Type', value: alert.monitor.type.toUpperCase(), inline: true },
                  { name: 'Latency', value: `${alert.result.latency_ms}ms`, inline: true },
                  ...(isUp && alert.downtimeSeconds
                    ? [{ name: 'Downtime', value: formatDuration(alert.downtimeSeconds), inline: true }]
                    : []),
                ],
                timestamp: timeIso,
                footer: { text: 'UptimeFlare' },
              },
            ],
          }),
        });
        if (!res.ok) return { ok: false, error: `Discord HTTP ${res.status}` };
        return { ok: true };
      }

      case 'slack': {
        const webhookUrl = (config.webhook_url || '').trim();
        if (!webhookUrl) return { ok: false, error: 'Missing Slack webhook_url' };

        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: plainText,
            blocks: [
              {
                type: 'header',
                text: { type: 'plain_text', text: title, emoji: true },
              },
              {
                type: 'section',
                fields: [
                  { type: 'mrkdwn', text: `*Target:*\n\`${alert.monitor.url_or_host}\`` },
                  { type: 'mrkdwn', text: `*Latency:*\n${alert.result.latency_ms}ms` },
                  { type: 'mrkdwn', text: `*Details:*\n${alert.result.message}` },
                  { type: 'mrkdwn', text: `*Time:*\n${timeIso}` },
                ],
              },
            ],
          }),
        });
        if (!res.ok) return { ok: false, error: `Slack HTTP ${res.status}` };
        return { ok: true };
      }

      case 'telegram': {
        const botToken = (config.bot_token || '').trim();
        const chatId = (config.chat_id || '').trim();
        if (!botToken || !chatId) {
          return { ok: false, error: 'Missing Telegram bot_token or chat_id' };
        }
        const tgUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
        const res = await fetch(tgUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: plainText,
            disable_web_page_preview: true,
          }),
        });
        if (!res.ok) return { ok: false, error: `Telegram HTTP ${res.status}` };
        return { ok: true };
      }

      case 'ntfy': {
        const serverUrl = (config.server_url || 'https://ntfy.sh').replace(/\/+$/, '');
        const topic = (config.topic || '').trim();
        if (!topic) return { ok: false, error: 'Missing Ntfy topic' };

        const headers: Record<string, string> = {
          Title: title,
          Priority: alert.event === 'down' ? 'high' : 'default',
          Tags: isTest ? 'bell' : isUp ? 'white_check_mark' : 'rotating_light',
        };
        if (config.token) {
          headers.Authorization = `Bearer ${config.token.trim()}`;
        }

        const res = await fetch(`${serverUrl}/${encodeURIComponent(topic)}`, {
          method: 'POST',
          headers,
          body: summaryLines.join('\n'),
        });
        if (!res.ok) return { ok: false, error: `Ntfy HTTP ${res.status}` };
        return { ok: true };
      }

      case 'pushover': {
        const appToken = (config.app_token || '').trim();
        const userKey = (config.user_key || '').trim();
        if (!appToken || !userKey) {
          return { ok: false, error: 'Missing Pushover app_token or user_key' };
        }
        const res = await fetch('https://api.pushover.net/1/messages.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: appToken,
            user: userKey,
            title,
            message: summaryLines.join('\n'),
            priority: alert.event === 'down' ? 1 : 0,
          }),
        });
        if (!res.ok) return { ok: false, error: `Pushover HTTP ${res.status}` };
        return { ok: true };
      }

      case 'webhook':
      default: {
        const webhookUrl = (config.webhook_url || '').trim();
        if (!webhookUrl) return { ok: false, error: 'Missing custom webhook_url' };

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'User-Agent': 'UptimeFlare-Webhook/1.0',
        };
        if (config.secret_header && config.secret_value) {
          headers[config.secret_header.trim()] = config.secret_value.trim();
        }

        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            source: 'UptimeFlare',
            event: alert.event,
            title,
            monitor: alert.monitor,
            result: alert.result,
            downtime_seconds: alert.downtimeSeconds ?? null,
            timestamp: timeIso,
          }),
        });
        if (!res.ok) return { ok: false, error: `Webhook HTTP ${res.status}` };
        return { ok: true };
      }
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Notification delivery failed',
    };
  }
}

export async function notifyMonitorTransition(
  db: D1Database,
  monitor: MonitorRow,
  event: 'down' | 'up',
  result: CheckResult,
  downtimeSeconds?: number
): Promise<void> {
  const { results: channels } = await db
    .prepare('SELECT * FROM notification_channels WHERE active = 1')
    .all<NotificationChannelRow>();

  if (!channels || channels.length === 0) return;

  let boundIds: number[] = [];
  try {
    boundIds = JSON.parse(monitor.notification_ids || '[]');
  } catch {
    boundIds = [];
  }

  const targetChannels = channels.filter((ch) => {
    if (boundIds.length > 0) {
      return boundIds.includes(ch.id);
    }
    return ch.is_default === 1;
  });

  if (targetChannels.length === 0) return;

  const alertPayload: AlertEvent = {
    monitor: {
      id: monitor.id,
      name: monitor.name,
      type: monitor.type,
      url_or_host: monitor.url_or_host,
      group_name: monitor.group_name,
    },
    event,
    result,
    downtimeSeconds,
    timestamp: Date.now(),
  };

  await Promise.allSettled(targetChannels.map((ch) => dispatchChannelAlert(ch, alertPayload)));
}
