import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Edit3,
  ExternalLink,
  Pause,
  Play,
  RefreshCw,
  Terminal,
  Trash2,
} from 'lucide-react';
import { api } from '../api';
import { Heartbeat, Incident, Monitor } from '../types';
import { HeartbeatBar } from './HeartbeatBar';
import { LatencyChart } from './LatencyChart';

interface MonitorDetailProps {
  monitor: Monitor;
  onCheckNow: (id: number) => Promise<void>;
  onTogglePause: (id: number) => Promise<void>;
  onEdit: (monitor: Monitor) => void;
  onClone: (monitor: Monitor) => void;
  onDelete: (id: number) => Promise<void>;
  isChecking: boolean;
}

export const MonitorDetail: React.FC<MonitorDetailProps> = ({
  monitor,
  onCheckNow,
  onTogglePause,
  onEdit,
  onClone,
  onDelete,
  isChecking,
}) => {
  const [range, setRange] = useState<'24h' | '7d'>('24h');
  const [historyBeats, setHistoryBeats] = useState<Heartbeat[]>(monitor.heartbeats);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [copiedPush, setCopiedPush] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHistoryBeats(monitor.heartbeats);
    api
      .getMonitorHistory(monitor.id, range)
      .then((res) => {
        if (!cancelled) {
          setHistoryBeats(res.heartbeats.length > 0 ? res.heartbeats : monitor.heartbeats);
          setIncidents(res.incidents);
        }
      })
      .catch(() => {
        // Fallback to monitor.heartbeats
      });
    return () => {
      cancelled = true;
    };
  }, [monitor.id, monitor.heartbeats, monitor.last_checked_at, range]);

  const pushUrl =
    monitor.type === 'push' && monitor.push_token
      ? `${window.location.origin}/api/push/${monitor.push_token}?status=up&msg=OK&ping=12`
      : '';

  const copyPushUrl = () => {
    if (!pushUrl) return;
    navigator.clipboard.writeText(pushUrl);
    setCopiedPush(true);
    setTimeout(() => setCopiedPush(false), 2000);
  };

  const latestBeat =
    monitor.heartbeats.length > 0 ? monitor.heartbeats[monitor.heartbeats.length - 1] : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Top Monitor Header Card */}
      <div className="cf-card">
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span className={`status-badge ${monitor.current_status}`}>
                <span className={`status-dot ${monitor.current_status}`} />
                {monitor.current_status}
              </span>
              <span className="protocol-chip mono">{monitor.type}</span>
              <span className="protocol-chip">{monitor.group_name}</span>
              {monitor.is_public === 1 && (
                <span className="tag-chip" title="Visible on /status public page">
                  Public Status
                </span>
              )}
              {monitor.tags.map((t) => (
                <span key={t} className="tag-chip">
                  #{t}
                </span>
              ))}
            </div>

            <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>
              {monitor.name}
            </h1>

            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              {monitor.type === 'http' ||
              monitor.type === 'keyword' ||
              monitor.type === 'json-query' ? (
                <a
                  href={
                    /^https?:\/\//i.test(monitor.url_or_host)
                      ? monitor.url_or_host
                      : `https://${monitor.url_or_host}`
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="mono"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13 }}
                >
                  <span>{monitor.url_or_host}</span>
                  <ExternalLink size={13} />
                </a>
              ) : (
                <span className="mono" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  {monitor.url_or_host}
                  {monitor.port ? `:${monitor.port}` : ''}
                </span>
              )}

              <span style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>
                Check every <strong className="mono">{monitor.interval_seconds}s</strong> • Retries:{' '}
                <strong className="mono">{monitor.max_retries}</strong> • Timeout:{' '}
                <strong className="mono">{monitor.timeout_ms}ms</strong>
              </span>
            </div>
          </div>

          {/* Action Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              id="btn-detail-check-now"
              className="btn btn-primary btn-sm"
              onClick={() => onCheckNow(monitor.id)}
              disabled={isChecking}
            >
              <RefreshCw size={14} />
              <span>{isChecking ? 'Checking...' : 'Check Now'}</span>
            </button>

            <button
              type="button"
              id="btn-detail-toggle-pause"
              className="btn btn-sm"
              onClick={() => onTogglePause(monitor.id)}
            >
              {monitor.active === 1 ? (
                <>
                  <Pause size={14} />
                  <span>Pause</span>
                </>
              ) : (
                <>
                  <Play size={14} />
                  <span>Resume</span>
                </>
              )}
            </button>

            <button
              type="button"
              id="btn-detail-edit"
              className="btn btn-sm"
              onClick={() => onEdit(monitor)}
            >
              <Edit3 size={14} />
              <span>Edit</span>
            </button>

            <button
              type="button"
              id="btn-detail-clone"
              className="btn btn-sm"
              onClick={() => onClone(monitor)}
            >
              <Copy size={14} />
              <span>Clone</span>
            </button>

            <button
              type="button"
              id="btn-detail-delete"
              className="btn btn-danger btn-sm"
              onClick={() => {
                if (window.confirm(`Delete monitor "${monitor.name}" and its history?`)) {
                  onDelete(monitor.id);
                }
              }}
            >
              <Trash2 size={14} />
              <span>Delete</span>
            </button>
          </div>
        </div>

        {/* Inbound Push URL Box for Push Monitors */}
        {monitor.type === 'push' && pushUrl && (
          <div
            style={{
              marginTop: 16,
              paddingTop: 16,
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--cf-orange)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Terminal size={14} />
              <span>Inbound Push Heartbeat Endpoint (Call from cron or private server)</span>
            </div>
            <div className="cf-code-box">
              <code className="mono">{`curl -fsS "${pushUrl}"`}</code>
              <button type="button" className="btn btn-sm" onClick={copyPushUrl}>
                {copiedPush ? <Check size={13} /> : <Copy size={13} />}
                <span>{copiedPush ? 'Copied' : 'Copy URL'}</span>
              </button>
            </div>
          </div>
        )}

        {/* 60-Tick Interactive Heartbeat Bar */}
        <div style={{ marginTop: 18 }}>
          <HeartbeatBar heartbeats={monitor.heartbeats} slots={60} />
        </div>
      </div>

      {/* 4 Telemetry KPI Cards */}
      <div className="cf-kpi-grid">
        <div className="cf-kpi-card accent-orange">
          <div className="cf-kpi-label">Current Ping</div>
          <div className="cf-kpi-value mono">
            {monitor.last_latency_ms !== null ? `${monitor.last_latency_ms} ms` : '—'}
          </div>
          <div className="cf-kpi-sub">
            {latestBeat?.message ? latestBeat.message : 'Awaiting probe'}
          </div>
        </div>

        <div className="cf-kpi-card accent-blue">
          <div className="cf-kpi-label">Avg Latency (24h)</div>
          <div className="cf-kpi-value mono">{monitor.avg_latency_24h || 0} ms</div>
          <div className="cf-kpi-sub">Mean edge round-trip time</div>
        </div>

        <div className="cf-kpi-card accent-up">
          <div className="cf-kpi-label">Uptime (24 Hours)</div>
          <div className="cf-kpi-value mono">{monitor.uptime_24h.toFixed(2)}%</div>
          <div className="cf-kpi-sub">
            {monitor.consecutive_failures > 0
              ? `${monitor.consecutive_failures} consecutive failure(s)`
              : 'Zero active failures'}
          </div>
        </div>

        <div className="cf-kpi-card accent-up">
          <div className="cf-kpi-label">Uptime (30 Days)</div>
          <div className="cf-kpi-value mono">{monitor.uptime_30d.toFixed(2)}%</div>
          <div className="cf-kpi-sub">Stored in Cloudflare D1</div>
        </div>
      </div>

      {/* SVG Response Time Latency Area Chart */}
      <LatencyChart heartbeats={historyBeats} range={range} onRangeChange={setRange} />

      {/* Incident History for this Monitor */}
      <div className="cf-card">
        <div className="cf-card-header">
          <div>
            <div className="cf-card-title">Incident & Outage Log</div>
            <div className="cf-card-subtitle">
              Status transitions and root-cause telemetry for {monitor.name}
            </div>
          </div>
        </div>

        {incidents.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            No incidents recorded for this monitor.
          </div>
        ) : (
          <div className="cf-table-wrap">
            <table className="cf-table">
              <thead>
                <tr>
                  <th>State</th>
                  <th>Cause</th>
                  <th>Started</th>
                  <th>Resolved</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((inc) => {
                  const resolved = inc.resolved_at !== null;
                  const durSec = resolved
                    ? Math.max(1, Math.round(((inc.resolved_at as number) - inc.started_at) / 1000))
                    : Math.max(1, Math.round((Date.now() - inc.started_at) / 1000));
                  return (
                    <tr key={inc.id}>
                      <td>
                        <span className={`status-badge ${resolved ? 'up' : 'down'}`}>
                          {resolved ? 'Resolved' : 'Ongoing'}
                        </span>
                      </td>
                      <td className="mono" style={{ fontSize: 12 }}>
                        {inc.cause}
                      </td>
                      <td className="mono" style={{ fontSize: 12 }}>
                        {new Date(inc.started_at).toLocaleString()}
                      </td>
                      <td className="mono" style={{ fontSize: 12 }}>
                        {resolved ? new Date(inc.resolved_at as number).toLocaleString() : 'Active'}
                      </td>
                      <td className="mono" style={{ fontSize: 12 }}>
                        {Math.floor(durSec / 60)}m {durSec % 60}s
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
