import React, { useRef, useState } from 'react';
import { Bell, Download, Plus, Send, Settings, Trash2, Upload, X } from 'lucide-react';
import { api } from '../api';
import { NotificationChannel, NotificationProvider, SiteSettings } from '../types';

interface SettingsModalProps {
  settings: SiteSettings;
  channels: NotificationChannel[];
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  channels,
  onClose,
  onRefresh,
}) => {
  const [activeTab, setActiveTab] = useState<'general' | 'alerts'>('general');

  // General Settings State
  const [siteTitle, setSiteTitle] = useState(settings.site_title || 'UptimeFlare');
  const [siteDescription, setSiteDescription] = useState(
    settings.site_description || 'Cloudflare Edge Infrastructure & Service Status'
  );
  const [publicEnabled, setPublicEnabled] = useState(
    settings.public_status_enabled === 'true'
  );
  const [announcement, setAnnouncement] = useState(settings.public_announcement || '');
  const [retentionDays, setRetentionDays] = useState(settings.retention_days || '30');
  const [cfTeamDomain, setCfTeamDomain] = useState(settings.cf_access_team_domain || '');
  const [cfAud, setCfAud] = useState(settings.cf_access_aud || '');

  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Alert Channels State
  const [channelName, setChannelName] = useState('');
  const [provider, setProvider] = useState<NotificationProvider>('smtp');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [ntfyServer, setNtfyServer] = useState('https://ntfy.sh');
  const [ntfyTopic, setNtfyTopic] = useState('');
  const [pushoverToken, setPushoverToken] = useState('');
  const [pushoverUser, setPushoverUser] = useState('');
  const [secretHeader, setSecretHeader] = useState('');
  const [secretValue, setSecretValue] = useState('');

  // SMTP & Email API fields
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpSecurity, setSmtpSecurity] = useState<'starttls' | 'tls'>('starttls');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [emailService, setEmailService] = useState<'resend' | 'sendgrid'>('resend');
  const [emailApiKey, setEmailApiKey] = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [toEmail, setToEmail] = useState('');
  const [isDefault, setIsDefault] = useState(true);

  const [alertFeedback, setAlertFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );
  const [alertBusy, setAlertBusy] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      await api.updateSettings({
        site_title: siteTitle.trim() || 'UptimeFlare',
        site_description: siteDescription.trim(),
        public_status_enabled: publicEnabled ? 'true' : 'false',
        public_announcement: announcement.trim(),
        retention_days: String(Math.max(1, Number(retentionDays) || 30)),
        cf_access_team_domain: cfTeamDomain.trim(),
        cf_access_aud: cfAud.trim(),
      });
      await onRefresh();
      setFeedback({ type: 'ok', text: 'Settings saved to Cloudflare D1.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to save settings',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    try {
      const backup = await api.exportBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `uptimeflare-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Export failed',
      });
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await api.importBackup(json);
      await onRefresh();
      setFeedback({
        type: 'ok',
        text: `Imported ${res.imported_monitors} monitors and ${res.imported_channels} notification channels.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Invalid backup JSON file',
      });
    }
  };

  const buildAlertConfig = (): Record<string, string> => {
    switch (provider) {
      case 'smtp':
        return {
          smtp_host: smtpHost.trim(),
          smtp_port: smtpPort.trim() || '587',
          smtp_security: smtpSecurity,
          smtp_user: smtpUser.trim(),
          smtp_pass: smtpPass,
          from_email: fromEmail.trim(),
          to_email: toEmail.trim(),
        };
      case 'email':
        return {
          email_service: emailService,
          api_key: emailApiKey.trim(),
          from_email: fromEmail.trim(),
          to_email: toEmail.trim(),
        };
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

  const handleTestAlert = async () => {
    setAlertFeedback(null);
    setAlertBusy(true);
    try {
      await api.testNotification({
        name: channelName || 'Test Channel',
        provider,
        config: buildAlertConfig(),
      });
      setAlertFeedback({ type: 'ok', text: 'Test alert delivered successfully!' });
    } catch (err) {
      setAlertFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Test alert failed',
      });
    } finally {
      setAlertBusy(false);
    }
  };

  const handleAddChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!channelName.trim()) {
      setAlertFeedback({ type: 'err', text: 'Channel name is required.' });
      return;
    }
    setAlertFeedback(null);
    setAlertBusy(true);
    try {
      await api.createNotification({
        name: channelName.trim(),
        provider,
        config: buildAlertConfig(),
        is_default: isDefault,
        active: true,
      });
      setChannelName('');
      setWebhookUrl('');
      setNtfyTopic('');
      setSmtpPass('');
      setEmailApiKey('');
      await onRefresh();
      setAlertFeedback({ type: 'ok', text: 'Notification channel added.' });
    } catch (err) {
      setAlertFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to create channel',
      });
    } finally {
      setAlertBusy(false);
    }
  };

  const handleDeleteChannel = async (id: number) => {
    await api.deleteNotification(id);
    await onRefresh();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings size={17} style={{ color: 'var(--cf-orange)' }} />
            <span>Settings & Alerts</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="cf-theme-switcher">
              <button
                type="button"
                id="settings-tab-general"
                className={`cf-theme-btn ${activeTab === 'general' ? 'active' : ''}`}
                onClick={() => setActiveTab('general')}
              >
                <Settings size={13} />
                <span>General & Backup</span>
              </button>
              <button
                type="button"
                id="settings-tab-alerts"
                className={`cf-theme-btn ${activeTab === 'alerts' ? 'active' : ''}`}
                onClick={() => setActiveTab('alerts')}
              >
                <Bell size={13} />
                <span>Alerts ({channels.length})</span>
              </button>
            </div>

            <button type="button" className="btn btn-icon" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>

        {activeTab === 'general' ? (
          <form onSubmit={handleSave}>
            <div className="modal-body">
              {feedback && (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 13,
                    background:
                      feedback.type === 'ok' ? 'var(--status-up-bg)' : 'var(--status-down-bg)',
                    color: feedback.type === 'ok' ? 'var(--status-up)' : 'var(--status-down)',
                    border: `1px solid ${
                      feedback.type === 'ok'
                        ? 'var(--status-up-border)'
                        : 'var(--status-down-border)'
                    }`,
                  }}
                >
                  {feedback.text}
                </div>
              )}

              <div className="form-grid">
                <div className="form-field">
                  <label className="form-label">Dashboard & Status Page Title</label>
                  <input
                    type="text"
                    className="form-input"
                    value={siteTitle}
                    onChange={(e) => setSiteTitle(e.target.value)}
                  />
                </div>

                <div className="form-field">
                  <label className="form-label">D1 Heartbeat Retention (Days)</label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    className="form-input mono"
                    value={retentionDays}
                    onChange={(e) => setRetentionDays(e.target.value)}
                  />
                  <span className="form-hint">
                    Automatically prunes older heartbeats to stay within the 5 GB D1 free tier.
                  </span>
                </div>

                <div className="form-field full">
                  <div className="cf-toggle-card">
                    <div>
                      <div className="form-label">Public Read-Only Status Page (/status)</div>
                      <span className="form-hint">
                        Disabled by default. Toggle on to allow read-only access to public monitors
                        at <code>/status</code>.
                      </span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={publicEnabled}
                      id="toggle-public-status"
                      className={`cf-toggle-switch ${publicEnabled ? 'checked' : ''}`}
                      onClick={() => setPublicEnabled((prev) => !prev)}
                    >
                      <span className="cf-toggle-knob" />
                    </button>
                  </div>
                </div>

                {publicEnabled && (
                  <>
                    <div className="form-field full">
                      <label className="form-label">Public Status Page Subtitle</label>
                      <input
                        type="text"
                        className="form-input"
                        value={siteDescription}
                        onChange={(e) => setSiteDescription(e.target.value)}
                      />
                    </div>

                    <div className="form-field full">
                      <label className="form-label">
                        Public Maintenance / Incident Announcement Banner (Optional)
                      </label>
                      <textarea
                        rows={2}
                        className="form-textarea"
                        placeholder="e.g. Scheduled maintenance on US-East nodes at 02:00 UTC."
                        value={announcement}
                        onChange={(e) => setAnnouncement(e.target.value)}
                      />
                    </div>
                  </>
                )}
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--border-subtle)' }} />

              <div className="form-grid">
                <div className="form-field full">
                  <div className="form-label">
                    Cloudflare Zero Trust (In-Worker JWT Verification)
                  </div>
                  <span className="form-hint">
                    Optional: Enter your Cloudflare Access Team Domain and Application Audience
                    (AUD) Tag to enforce RS256 cryptographic JWT verification inside the Worker
                    (can also be set via Worker Variables <code>CF_ACCESS_TEAM_DOMAIN</code> and{' '}
                    <code>CF_ACCESS_AUD</code>).
                  </span>
                </div>

                <div className="form-field">
                  <label className="form-label">Team Domain</label>
                  <input
                    type="text"
                    className="form-input mono"
                    placeholder="my-team.cloudflareaccess.com"
                    value={cfTeamDomain}
                    onChange={(e) => setCfTeamDomain(e.target.value)}
                  />
                </div>

                <div className="form-field">
                  <label className="form-label">Application Audience (AUD) Tag</label>
                  <input
                    type="text"
                    className="form-input mono"
                    placeholder="e.g. 737646a56ab1df6ec9bddc7e5ca84eaf..."
                    value={cfAud}
                    onChange={(e) => setCfAud(e.target.value)}
                  />
                </div>
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--border-subtle)' }} />

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="form-label">Configuration Backup (JSON Export / Import)</div>
                <p className="form-hint">
                  Export or restore all monitor configurations, notification channels, and settings.
                </p>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button type="button" className="btn" onClick={handleExport}>
                    <Download size={14} />
                    <span>Export JSON Backup</span>
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload size={14} />
                    <span>Import JSON Backup</span>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json"
                    style={{ display: 'none' }}
                    onChange={handleImportFile}
                  />
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <span className="form-hint">Cloudflare Free Tier D1 + Workers</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn" onClick={onClose}>
                  Close
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </div>
          </form>
        ) : (
          <div className="modal-body">
            {/* Existing Channels List */}
            <div>
              <div className="form-label" style={{ marginBottom: 8 }}>
                Configured Alert Channels ({channels.length})
              </div>
              {channels.length === 0 ? (
                <div
                  style={{
                    padding: '12px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-muted)',
                    fontSize: 13,
                  }}
                >
                  No notification channels configured yet. Add one below to receive DOWN and UP
                  recovery alerts.
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
                        borderRadius: 'var(--radius-md)',
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
                        onClick={() => handleDeleteChannel(ch.id)}
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
            <form
              onSubmit={handleAddChannel}
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              <div className="form-label" style={{ color: 'var(--cf-orange)' }}>
                + Add Notification Channel
              </div>

              {alertFeedback && (
                <div
                  style={{
                    padding: '9px 12px',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 13,
                    background:
                      alertFeedback.type === 'ok' ? 'var(--status-up-bg)' : 'var(--status-down-bg)',
                    color:
                      alertFeedback.type === 'ok' ? 'var(--status-up)' : 'var(--status-down)',
                    border: `1px solid ${
                      alertFeedback.type === 'ok'
                        ? 'var(--status-up-border)'
                        : 'var(--status-down-border)'
                    }`,
                  }}
                >
                  {alertFeedback.text}
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
                    <option value="smtp">Email (Direct SMTP / STARTTLS / SSL)</option>
                    <option value="email">Email API (Resend / SendGrid)</option>
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
                    placeholder="e.g. Ops Email Alerts"
                    value={channelName}
                    onChange={(e) => setChannelName(e.target.value)}
                  />
                </div>

                {provider === 'smtp' && (
                  <>
                    <div className="form-field">
                      <label className="form-label">SMTP Hostname</label>
                      <input
                        type="text"
                        className="form-input mono"
                        placeholder="smtp.gmail.com / smtp.fastmail.com"
                        value={smtpHost}
                        onChange={(e) => setSmtpHost(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-field">
                      <label className="form-label">SMTP Port & Security</label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          type="number"
                          className="form-input mono"
                          style={{ width: 100 }}
                          value={smtpPort}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSmtpPort(val);
                            if (val === '465') setSmtpSecurity('tls');
                            else if (val === '587' || val === '2525') setSmtpSecurity('starttls');
                          }}
                          required
                        />
                        <select
                          className="form-select"
                          value={smtpSecurity}
                          onChange={(e) => setSmtpSecurity(e.target.value as 'starttls' | 'tls')}
                        >
                          <option value="starttls">STARTTLS (Port 587 / 2525)</option>
                          <option value="tls">Implicit SSL/TLS (Port 465)</option>
                        </select>
                      </div>
                    </div>
                    <div className="form-field">
                      <label className="form-label">SMTP Username</label>
                      <input
                        type="text"
                        className="form-input mono"
                        placeholder="alerts@example.com"
                        value={smtpUser}
                        onChange={(e) => setSmtpUser(e.target.value)}
                      />
                    </div>
                    <div className="form-field">
                      <label className="form-label">SMTP Password / App Password</label>
                      <input
                        type="password"
                        className="form-input mono"
                        placeholder="••••••••••••"
                        value={smtpPass}
                        onChange={(e) => setSmtpPass(e.target.value)}
                      />
                    </div>
                    <div className="form-field">
                      <label className="form-label">From Email</label>
                      <input
                        type="text"
                        className="form-input mono"
                        placeholder="UptimeFlare <alerts@example.com>"
                        value={fromEmail}
                        onChange={(e) => setFromEmail(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-field">
                      <label className="form-label">To Email (Comma-separated)</label>
                      <input
                        type="text"
                        className="form-input mono"
                        placeholder="admin@example.com, ops@example.com"
                        value={toEmail}
                        onChange={(e) => setToEmail(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-field full">
                      <span className="form-hint">
                        Uses Cloudflare Workers TCP sockets (<code>cloudflare:sockets</code>). Port
                        25 is blocked by Cloudflare; use port <strong>587</strong> /{' '}
                        <strong>2525</strong> (STARTTLS) or <strong>465</strong> (SSL/TLS).
                      </span>
                    </div>
                  </>
                )}

                {provider === 'email' && (
                  <>
                    <div className="form-field">
                      <label className="form-label">Email API Service</label>
                      <select
                        className="form-select"
                        value={emailService}
                        onChange={(e) => setEmailService(e.target.value as 'resend' | 'sendgrid')}
                      >
                        <option value="resend">Resend (api.resend.com)</option>
                        <option value="sendgrid">SendGrid (api.sendgrid.com)</option>
                      </select>
                    </div>
                    <div className="form-field">
                      <label className="form-label">API Key</label>
                      <input
                        type="password"
                        className="form-input mono"
                        placeholder="re_123456... or SG.123456..."
                        value={emailApiKey}
                        onChange={(e) => setEmailApiKey(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-field">
                      <label className="form-label">From Email</label>
                      <input
                        type="text"
                        className="form-input mono"
                        placeholder="UptimeFlare <alerts@example.com>"
                        value={fromEmail}
                        onChange={(e) => setFromEmail(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-field">
                      <label className="form-label">To Email (Comma-separated)</label>
                      <input
                        type="text"
                        className="form-input mono"
                        placeholder="admin@example.com"
                        value={toEmail}
                        onChange={(e) => setToEmail(e.target.value)}
                        required
                      />
                    </div>
                  </>
                )}

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
                <button
                  type="button"
                  className="btn"
                  onClick={handleTestAlert}
                  disabled={alertBusy}
                >
                  <Send size={14} />
                  <span>Send Test Alert</span>
                </button>

                <button type="submit" className="btn btn-primary" disabled={alertBusy}>
                  <Plus size={14} />
                  <span>Save Channel</span>
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
