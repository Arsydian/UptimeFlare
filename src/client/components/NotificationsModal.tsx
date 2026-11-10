import React, { useState } from 'react';
import { Bell, Plus, Send, Trash2, X } from 'lucide-react';
import { api } from '../api';
import { NotificationChannel, NotificationProvider } from '../types';

interface NotificationsModalProps {
  channels: NotificationChannel[];
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

export const NotificationsModal: React.FC<NotificationsModalProps> = ({
  channels,
  onClose,
  onRefresh,
}) => {
  const [name, setName] = useState('');
  const [provider, setProvider] = useState<NotificationProvider>('discord');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [ntfyServer, setNtfyServer] = useState('https://ntfy.sh');
  const [ntfyTopic, setNtfyTopic] = useState('');
  const [pushoverToken, setPushoverToken] = useState('');
  const [pushoverUser, setPushoverUser] = useState('');
  const [secretHeader, setSecretHeader] = useState('');
  const [secretValue, setSecretValue] = useState('');
  const [isDefault, setIsDefault] = useState(true);

  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const buildConfig = (): Record<string, string> => {
    switch (provider) {
      case 'discord':
      case 'slack':
        return { webhook_url: webhookUrl.trim() };
      case 'telegram':
        return { bot_token: botToken.trim(), chat_id: chatId.trim() };
      case 'ntfy':
        return { server_url: ntfyServer.trim() || 'https://ntfy.sh', topic: ntfyTopic.trim() };
      case 'pushover':
        return { app_token: pushoverToken.trim(), user_key: pushoverUser.trim() };
      case 'webhook':
      default:
        return {
          webhook_url: webhookUrl.trim(),
          secret_header: secretHeader.trim(),
          secret_value: secretValue.trim(),
        };
    }
  };

  const handleTest = async () => {
    setStatusMsg(null);
    setBusy(true);
    try {
      await api.testNotification({
        name: name || 'Test Channel',
        provider,
        config: buildConfig(),
      });
      setStatusMsg({ type: 'ok', text: 'Test alert delivered successfully!' });
    } catch (err) {
      setStatusMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Test alert failed',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setStatusMsg({ type: 'err', text: 'Channel name is required.' });
      return;
    }
    setStatusMsg(null);
    setBusy(true);
    try {
      await api.createNotification({
        name: name.trim(),
        provider,
        config: buildConfig(),
        is_default: isDefault,
        active: true,
      });
      setName('');
      setWebhookUrl('');
      setNtfyTopic('');
      await onRefresh();
      setStatusMsg({ type: 'ok', text: 'Notification channel added.' });
    } catch (err) {
      setStatusMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to create channel',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: number) => {
    await api.deleteNotification(id);
    await onRefresh();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Bell size={17} style={{ color: 'var(--cf-orange)' }} />
            <span>Alert & Notification Channels</span>
          </div>
          <button type="button" className="btn btn-icon" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          {/* Existing Channels List */}
          <div>
            <div className="form-label" style={{ marginBottom: 8 }}>
              Configured Channels ({channels.length})
            </div>
            {channels.length === 0 ? (
              <div
                style={{
                  padding: '12px',
                  borderRadius: 6,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-muted)',
                  fontSize: 13,
                }}
              >
                No notification channels configured yet. Add one below to receive DOWN and UP recovery alerts.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {channels.map((ch) => (
                  <div
                    key={ch.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 12px',
                      borderRadius: 6,
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="protocol-chip mono">{ch.provider}</span>
                      <strong>{ch.name}</strong>
                      {ch.is_default === 1 && <span className="tag-chip">Default for all</span>}
                    </div>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => handleDelete(ch.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border-subtle)' }} />

          {/* Add New Channel Form */}
          <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-label" style={{ color: 'var(--cf-orange)' }}>
              + Add Notification Channel
            </div>

            {statusMsg && (
              <div
                style={{
                  padding: '9px 12px',
                  borderRadius: 6,
                  fontSize: 13,
                  background:
                    statusMsg.type === 'ok' ? 'var(--status-up-bg)' : 'var(--status-down-bg)',
                  color: statusMsg.type === 'ok' ? 'var(--status-up)' : 'var(--status-down)',
                  border: `1px solid ${
                    statusMsg.type === 'ok'
                      ? 'var(--status-up-border)'
                      : 'var(--status-down-border)'
                  }`,
                }}
              >
                {statusMsg.text}
              </div>
            )}

            <div className="form-grid">
              <div className="form-field">
                <label className="form-label">Provider</label>
                <select
                  className="form-select"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as NotificationProvider)}
                >
                  <option value="discord">Discord Webhook</option>
                  <option value="slack">Slack Incoming Webhook</option>
                  <option value="telegram">Telegram Bot</option>
                  <option value="ntfy">Ntfy.sh Push</option>
                  <option value="pushover">Pushover</option>
                  <option value="webhook">Generic Custom Webhook (JSON POST)</option>
                </select>
              </div>

              <div className="form-field">
                <label className="form-label">Channel Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Ops Discord #alerts"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              {(provider === 'discord' || provider === 'slack' || provider === 'webhook') && (
                <div className="form-field full">
                  <label className="form-label">Webhook URL</label>
                  <input
                    type="url"
                    className="form-input mono"
                    placeholder="https://discord.com/api/webhooks/..."
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    required
                  />
                </div>
              )}

              {provider === 'webhook' && (
                <>
                  <div className="form-field">
                    <label className="form-label">Custom Header Name (Optional)</label>
                    <input
                      type="text"
                      className="form-input mono"
                      placeholder="X-Webhook-Secret"
                      value={secretHeader}
                      onChange={(e) => setSecretHeader(e.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label">Custom Header Value</label>
                    <input
                      type="password"
                      className="form-input mono"
                      placeholder="secret-token"
                      value={secretValue}
                      onChange={(e) => setSecretValue(e.target.value)}
                    />
                  </div>
                </>
              )}

              {provider === 'telegram' && (
                <>
                  <div className="form-field">
                    <label className="form-label">Bot Token</label>
                    <input
                      type="password"
                      className="form-input mono"
                      placeholder="123456:ABC-DEF..."
                      value={botToken}
                      onChange={(e) => setBotToken(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label">Chat ID</label>
                    <input
                      type="text"
                      className="form-input mono"
                      placeholder="-100123456789"
                      value={chatId}
                      onChange={(e) => setChatId(e.target.value)}
                      required
                    />
                  </div>
                </>
              )}

              {provider === 'ntfy' && (
                <>
                  <div className="form-field">
                    <label className="form-label">Ntfy Server URL</label>
                    <input
                      type="url"
                      className="form-input mono"
                      value={ntfyServer}
                      onChange={(e) => setNtfyServer(e.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label">Topic Name</label>
                    <input
                      type="text"
                      className="form-input mono"
                      placeholder="my-secret-uptime-topic"
                      value={ntfyTopic}
                      onChange={(e) => setNtfyTopic(e.target.value)}
                      required
                    />
                  </div>
                </>
              )}

              {provider === 'pushover' && (
                <>
                  <div className="form-field">
                    <label className="form-label">Application API Token</label>
                    <input
                      type="password"
                      className="form-input mono"
                      value={pushoverToken}
                      onChange={(e) => setPushoverToken(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label">User / Group Key</label>
                    <input
                      type="text"
                      className="form-input mono"
                      value={pushoverUser}
                      onChange={(e) => setPushoverUser(e.target.value)}
                      required
                    />
                  </div>
                </>
              )}

              <div className="form-field full">
                <label className="form-checkbox-row">
                  <input
                    type="checkbox"
                    checked={isDefault}
                    onChange={(e) => setIsDefault(e.target.checked)}
                  />
                  <span>Enable by default for all monitors</span>
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <button type="button" className="btn" onClick={handleTest} disabled={busy}>
                <Send size={14} />
                <span>Send Test Alert</span>
              </button>

              <button type="submit" className="btn btn-primary" disabled={busy}>
                <Plus size={14} />
                <span>Save Channel</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
