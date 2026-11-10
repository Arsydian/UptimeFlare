import React, { useState } from 'react';
import { Play, X } from 'lucide-react';
import { api } from '../api';
import { Monitor, MonitorType, NotificationChannel } from '../types';

interface MonitorModalProps {
  initialMonitor?: Monitor | null;
  isClone?: boolean;
  notifications: NotificationChannel[];
  onClose: () => void;
  onSave: (payload: Record<string, unknown>, editId?: number) => Promise<void>;
}

export const MonitorModal: React.FC<MonitorModalProps> = ({
  initialMonitor,
  isClone = false,
  notifications,
  onClose,
  onSave,
}) => {
  const isEditing = Boolean(initialMonitor && !isClone);

  const [type, setType] = useState<MonitorType>(initialMonitor?.type || 'http');
  const [name, setName] = useState(
    initialMonitor ? (isClone ? `${initialMonitor.name} (Copy)` : initialMonitor.name) : ''
  );
  const [groupName, setGroupName] = useState(
    initialMonitor?.group_name || 'Core Infrastructure'
  );
  const [tagsInput, setTagsInput] = useState(
    initialMonitor?.tags ? initialMonitor.tags.join(', ') : ''
  );
  const [urlOrHost, setUrlOrHost] = useState(initialMonitor?.url_or_host || 'https://');
  const [port, setPort] = useState<string>(
    initialMonitor?.port ? String(initialMonitor.port) : '443'
  );
  const [method, setMethod] = useState(initialMonitor?.method || 'GET');
  const [expectedStatus, setExpectedStatus] = useState(
    initialMonitor?.expected_status || '200-299'
  );
  const [headers, setHeaders] = useState(
    initialMonitor?.headers && initialMonitor.headers !== '{}' ? initialMonitor.headers : ''
  );
  const [body, setBody] = useState(initialMonitor?.body || '');
  const [intervalSeconds, setIntervalSeconds] = useState<number>(
    initialMonitor?.interval_seconds || 60
  );
  const [timeoutMs, setTimeoutMs] = useState<number>(initialMonitor?.timeout_ms || 10000);
  const [maxRetries, setMaxRetries] = useState<number>(initialMonitor?.max_retries ?? 2);
  const [followRedirects, setFollowRedirects] = useState<boolean>(
    initialMonitor ? initialMonitor.follow_redirects === 1 : true
  );
  const [isPublic, setIsPublic] = useState<boolean>(
    initialMonitor ? initialMonitor.is_public === 1 : true
  );

  // Keyword fields
  const [keyword, setKeyword] = useState(initialMonitor?.keyword || '');
  const [keywordInverted, setKeywordInverted] = useState<boolean>(
    initialMonitor?.keyword_inverted === 1
  );

  // JSON Query fields
  const [jsonPath, setJsonPath] = useState(initialMonitor?.json_path || '');
  const [jsonOperator, setJsonOperator] = useState(initialMonitor?.json_operator || '==');
  const [jsonExpected, setJsonExpected] = useState(initialMonitor?.json_expected || '');

  // DNS fields
  const [dnsRecordType, setDnsRecordType] = useState(initialMonitor?.dns_record_type || 'A');
  const [dnsExpected, setDnsExpected] = useState(initialMonitor?.dns_expected || '');

  // Notification bindings
  const [selectedNotifIds, setSelectedNotifIds] = useState<number[]>(
    initialMonitor?.notification_ids || []
  );

  const [probeState, setProbeState] = useState<{
    loading: boolean;
    result?: { status: 'up' | 'down'; latency_ms: number; message: string };
    error?: string;
  }>({ loading: false });

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const buildPayload = (): Record<string, unknown> => {
    let parsedHeaders: Record<string, string> = {};
    if (headers.trim()) {
      parsedHeaders = JSON.parse(headers);
    }

    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    return {
      name: name.trim(),
      group_name: groupName.trim() || 'Core Infrastructure',
      tags,
      type,
      url_or_host: type === 'push' ? urlOrHost.trim() || 'inbound-push-agent' : urlOrHost.trim(),
      port: type === 'tcp' ? Number(port) || 443 : null,
      method,
      headers: parsedHeaders,
      body,
      timeout_ms: Number(timeoutMs) || 10000,
      interval_seconds: Number(intervalSeconds) || 60,
      max_retries: Number(maxRetries ?? 2),
      expected_status: expectedStatus.trim() || '200-299',
      follow_redirects: followRedirects ? 1 : 0,
      keyword: type === 'keyword' ? keyword : null,
      keyword_inverted: type === 'keyword' && keywordInverted ? 1 : 0,
      json_path: type === 'json-query' ? jsonPath : null,
      json_operator: type === 'json-query' ? jsonOperator : '==',
      json_expected: type === 'json-query' ? jsonExpected : null,
      dns_record_type: type === 'dns' ? dnsRecordType : 'A',
      dns_expected: type === 'dns' ? dnsExpected : null,
      is_public: isPublic ? 1 : 0,
      notification_ids: selectedNotifIds,
    };
  };

  const handleTestProbe = async () => {
    setFormError('');
    try {
      const payload = buildPayload();
      setProbeState({ loading: true });
      const res = await api.probeMonitor(payload);
      setProbeState({ loading: false, result: res });
    } catch (err) {
      setProbeState({
        loading: false,
        error: err instanceof Error ? err.message : 'Invalid monitor configuration',
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    try {
      const payload = buildPayload();
      if (!payload.name) {
        setFormError('Monitor friendly name is required.');
        return;
      }
      if (type !== 'push' && !payload.url_or_host) {
        setFormError('Target URL or hostname is required.');
        return;
      }
      setSaving(true);
      await onSave(payload, isEditing && initialMonitor ? initialMonitor.id : undefined);
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save monitor');
    } finally {
      setSaving(false);
    }
  };

  const toggleNotifId = (id: number) => {
    setSelectedNotifIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            {isEditing ? `Edit Monitor: ${initialMonitor?.name}` : 'Add New Uptime Monitor'}
          </div>
          <button type="button" className="btn btn-icon" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {formError && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 6,
                  background: 'var(--status-down-bg)',
                  border: '1px solid var(--status-down-border)',
                  color: 'var(--status-down)',
                  fontSize: 13,
                }}
              >
                {formError}
              </div>
            )}

            <div className="form-grid">
              <div className="form-field">
                <label className="form-label">Monitor Type</label>
                <select
                  id="monitor-type-select"
                  className="form-select"
                  value={type}
                  onChange={(e) => {
                    const nextType = e.target.value as MonitorType;
                    setType(nextType);
                    if (nextType === 'dns' || nextType === 'tcp') {
                      setUrlOrHost((prev) => prev.replace(/^https?:\/\//i, ''));
                    } else if (
                      (nextType === 'http' ||
                        nextType === 'keyword' ||
                        nextType === 'json-query') &&
                      !urlOrHost.startsWith('http')
                    ) {
                      setUrlOrHost(`https://${urlOrHost}`);
                    }
                  }}
                >
                  <option value="http">HTTP(s) — Status & Latency</option>
                  <option value="keyword">HTTP(s) Keyword — Response Body Match</option>
                  <option value="json-query">HTTP(s) JSON Query — API Assertion</option>
                  <option value="tcp">TCP Port — Server Socket Connect</option>
                  <option value="dns">DNS Record — 1.1.1.1 DoH Resolution</option>
                  <option value="push">Push / Heartbeat — Inbound Webhook URL</option>
                </select>
              </div>

              <div className="form-field">
                <label className="form-label">Friendly Name</label>
                <input
                  type="text"
                  id="monitor-name-input"
                  className="form-input"
                  placeholder="e.g. Production API Gateway"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              {type !== 'push' ? (
                <div className={`form-field ${type === 'tcp' ? '' : 'full'}`}>
                  <label className="form-label">
                    {type === 'tcp' || type === 'dns' ? 'Hostname / IP / Domain' : 'Target URL'}
                  </label>
                  <input
                    type="text"
                    id="monitor-target-input"
                    className="form-input mono"
                    placeholder={
                      type === 'tcp' || type === 'dns'
                        ? 'one.one.one.one'
                        : 'https://cloudflare.com'
                    }
                    value={urlOrHost}
                    onChange={(e) => setUrlOrHost(e.target.value)}
                    required
                  />
                </div>
              ) : (
                <div className="form-field full">
                  <label className="form-label">Server / Job Identifier</label>
                  <input
                    type="text"
                    className="form-input mono"
                    placeholder="e.g. backup-cron-worker-01"
                    value={urlOrHost}
                    onChange={(e) => setUrlOrHost(e.target.value)}
                  />
                  <span className="form-hint">
                    A unique Push URL will be generated automatically upon saving.
                  </span>
                </div>
              )}

              {type === 'tcp' && (
                <div className="form-field">
                  <label className="form-label">TCP Port</label>
                  <input
                    type="number"
                    className="form-input mono"
                    placeholder="443"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    required
                  />
                </div>
              )}

              {/* Keyword Options */}
              {type === 'keyword' && (
                <>
                  <div className="form-field">
                    <label className="form-label">Expected Keyword</label>
                    <input
                      type="text"
                      className="form-input mono"
                      placeholder="e.g. operational"
                      value={keyword}
                      onChange={(e) => setKeyword(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-field" style={{ justifyContent: 'flex-end' }}>
                    <label className="form-checkbox-row">
                      <input
                        type="checkbox"
                        checked={keywordInverted}
                        onChange={(e) => setKeywordInverted(e.target.checked)}
                      />
                      <span>Invert check (Alert DOWN if keyword IS present)</span>
                    </label>
                  </div>
                </>
              )}

              {/* JSON Query Options */}
              {type === 'json-query' && (
                <>
                  <div className="form-field">
                    <label className="form-label">JSON Path</label>
                    <input
                      type="text"
                      className="form-input mono"
                      placeholder="e.g. status.healthy or data.items[0].ok"
                      value={jsonPath}
                      onChange={(e) => setJsonPath(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label">Operator & Expected Value</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <select
                        className="form-select mono"
                        style={{ width: 110 }}
                        value={jsonOperator}
                        onChange={(e) => setJsonOperator(e.target.value)}
                      >
                        <option value="==">==</option>
                        <option value="!=">!=</option>
                        <option value="contains">contains</option>
                        <option value=">">&gt;</option>
                        <option value=">=">&gt;=</option>
                        <option value="<">&lt;</option>
                      </select>
                      <input
                        type="text"
                        className="form-input mono"
                        placeholder="true"
                        value={jsonExpected}
                        onChange={(e) => setJsonExpected(e.target.value)}
                      />
                    </div>
                  </div>
                </>
              )}

              {/* DNS Options */}
              {type === 'dns' && (
                <>
                  <div className="form-field">
                    <label className="form-label">DNS Record Type</label>
                    <select
                      className="form-select mono"
                      value={dnsRecordType}
                      onChange={(e) => setDnsRecordType(e.target.value)}
                    >
                      <option value="A">A (IPv4)</option>
                      <option value="AAAA">AAAA (IPv6)</option>
                      <option value="CNAME">CNAME</option>
                      <option value="MX">MX</option>
                      <option value="TXT">TXT</option>
                      <option value="NS">NS</option>
                    </select>
                  </div>
                  <div className="form-field">
                    <label className="form-label">Expected Answer Substring (Optional)</label>
                    <input
                      type="text"
                      className="form-input mono"
                      placeholder="e.g. 1.1.1.1"
                      value={dnsExpected}
                      onChange={(e) => setDnsExpected(e.target.value)}
                    />
                  </div>
                </>
              )}

              {/* HTTP Method & Expected Status Codes */}
              {(type === 'http' || type === 'keyword' || type === 'json-query') && (
                <>
                  <div className="form-field">
                    <label className="form-label">HTTP Method</label>
                    <select
                      className="form-select mono"
                      value={method}
                      onChange={(e) => setMethod(e.target.value)}
                    >
                      <option value="GET">GET</option>
                      <option value="HEAD">HEAD</option>
                      <option value="POST">POST</option>
                      <option value="PUT">PUT</option>
                      <option value="PATCH">PATCH</option>
                      <option value="DELETE">DELETE</option>
                    </select>
                  </div>
                  <div className="form-field">
                    <label className="form-label">Accepted Status Codes</label>
                    <input
                      type="text"
                      className="form-input mono"
                      placeholder="200-299, 301"
                      value={expectedStatus}
                      onChange={(e) => setExpectedStatus(e.target.value)}
                    />
                  </div>
                </>
              )}

              {/* Scheduling & Thresholds */}
              <div className="form-field">
                <label className="form-label">Heartbeat Interval</label>
                <select
                  className="form-select mono"
                  value={intervalSeconds}
                  onChange={(e) => setIntervalSeconds(Number(e.target.value))}
                >
                  <option value={60}>Every 1 minute (60s)</option>
                  <option value={180}>Every 3 minutes (180s)</option>
                  <option value={300}>Every 5 minutes (300s)</option>
                  <option value={600}>Every 10 minutes (600s)</option>
                  <option value={1800}>Every 30 minutes (1800s)</option>
                  <option value={3600}>Every 1 hour (3600s)</option>
                </select>
              </div>

              <div className="form-field">
                <label className="form-label">Retries Before DOWN Alert</label>
                <input
                  type="number"
                  min={0}
                  max={10}
                  className="form-input mono"
                  value={maxRetries}
                  onChange={(e) => setMaxRetries(Number(e.target.value))}
                />
              </div>

              <div className="form-field">
                <label className="form-label">Dashboard Group</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Core Infrastructure"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                />
              </div>

              <div className="form-field">
                <label className="form-label">Tags (Comma separated)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="prod, us-east, k8s"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                />
              </div>

              {(type === 'http' || type === 'keyword' || type === 'json-query') && (
                <div className="form-field full">
                  <label className="form-label">Custom Request Headers (JSON Optional)</label>
                  <input
                    type="text"
                    className="form-input mono"
                    placeholder='{"Authorization": "Bearer xxx", "X-Custom": "1"}'
                    value={headers}
                    onChange={(e) => setHeaders(e.target.value)}
                  />
                </div>
              )}

              {(type === 'http' || type === 'keyword' || type === 'json-query') &&
                method !== 'GET' &&
                method !== 'HEAD' && (
                  <div className="form-field full">
                    <label className="form-label">Request Body</label>
                    <textarea
                      rows={2}
                      className="form-textarea mono"
                      placeholder='{"ping": true}'
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                    />
                  </div>
                )}

              <div className="form-field">
                <label className="form-label">Timeout (ms)</label>
                <input
                  type="number"
                  min={1000}
                  max={30000}
                  step={500}
                  className="form-input mono"
                  value={timeoutMs}
                  onChange={(e) => setTimeoutMs(Number(e.target.value))}
                />
              </div>

              <div className="form-field" style={{ justifyContent: 'center', gap: 8 }}>
                <label className="form-checkbox-row">
                  <input
                    type="checkbox"
                    checked={isPublic}
                    onChange={(e) => setIsPublic(e.target.checked)}
                  />
                  <span>Display on Public Status Page (/status)</span>
                </label>

                {(type === 'http' || type === 'keyword' || type === 'json-query') && (
                  <label className="form-checkbox-row">
                    <input
                      type="checkbox"
                      checked={followRedirects}
                      onChange={(e) => setFollowRedirects(e.target.checked)}
                    />
                    <span>Follow HTTP 3xx Redirects</span>
                  </label>
                )}
              </div>

              {/* Notification Channel Bindings */}
              {notifications.length > 0 && (
                <div className="form-field full">
                  <label className="form-label">
                    Notification Channels (Leave unchecked to use all Default channels)
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
                    {notifications.map((ch) => (
                      <label key={ch.id} className="form-checkbox-row">
                        <input
                          type="checkbox"
                          checked={selectedNotifIds.includes(ch.id)}
                          onChange={() => toggleNotifId(ch.id)}
                        />
                        <span>
                          {ch.name} ({ch.provider})
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Live Edge Probe Feedback */}
            {(probeState.result || probeState.error) && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 6,
                  background:
                    probeState.result?.status === 'up'
                      ? 'var(--status-up-bg)'
                      : 'var(--status-down-bg)',
                  border: `1px solid ${
                    probeState.result?.status === 'up'
                      ? 'var(--status-up-border)'
                      : 'var(--status-down-border)'
                  }`,
                  color:
                    probeState.result?.status === 'up'
                      ? 'var(--status-up)'
                      : 'var(--status-down)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: 13,
                }}
              >
                <span>
                  <strong>
                    {probeState.result
                      ? `Edge Probe ${probeState.result.status.toUpperCase()}: `
                      : 'Probe Error: '}
                  </strong>
                  {probeState.result ? probeState.result.message : probeState.error}
                </span>
                {probeState.result && (
                  <span className="mono">{probeState.result.latency_ms} ms</span>
                )}
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button
              type="button"
              id="btn-modal-test-probe"
              className="btn"
              onClick={handleTestProbe}
              disabled={probeState.loading}
            >
              <Play size={14} />
              <span>{probeState.loading ? 'Testing from Edge...' : 'Test Probe'}</span>
            </button>

            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                id="btn-modal-save-monitor"
                className="btn btn-primary"
                disabled={saving}
              >
                {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Monitor'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
