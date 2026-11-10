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
                footer: { text: 'UptimeFlare • Cloudflare Workers Edge Monitor' },
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
