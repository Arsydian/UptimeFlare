import React, { useRef, useState } from 'react';
import { Download, Settings, Upload, X } from 'lucide-react';
import { api } from '../api';
import { SiteSettings } from '../types';

interface SettingsModalProps {
  settings: SiteSettings;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  onClose,
  onRefresh,
}) => {
  const [siteTitle, setSiteTitle] = useState(settings.site_title || 'UptimeFlare');
  const [siteDescription, setSiteDescription] = useState(
    settings.site_description || 'Cloudflare Edge Infrastructure & Service Status'
  );
  const [publicEnabled, setPublicEnabled] = useState(
    settings.public_status_enabled !== 'false'
  );
  const [announcement, setAnnouncement] = useState(settings.public_announcement || '');
  const [retentionDays, setRetentionDays] = useState(settings.retention_days || '30');

  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings size={17} style={{ color: 'var(--cf-orange)' }} />
            <span>UptimeFlare Settings, D1 Retention & Backup</span>
          </div>
          <button type="button" className="btn btn-icon" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSave}>
          <div className="modal-body">
            {feedback && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 6,
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

              <div className="form-field full">
                <label className="form-checkbox-row">
                  <input
                    type="checkbox"
                    checked={publicEnabled}
                    onChange={(e) => setPublicEnabled(e.target.checked)}
                  />
                  <span>Enable Public Read-Only Status Page at /status</span>
                </label>
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
      </div>
    </div>
  );
};
