import React from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Globe,
  RefreshCw,
  Server,
  Zap,
} from 'lucide-react';
import { Incident, Monitor } from '../types';
import { HeartbeatBar } from './HeartbeatBar';

interface FleetOverviewProps {
  monitors: Monitor[];
  incidents: Incident[];
  onSelectMonitor: (id: number) => void;
  onCheckMonitor: (id: number) => void;
  checkingId: number | null;
}

export const FleetOverview: React.FC<FleetOverviewProps> = ({
  monitors,
  incidents,
  onSelectMonitor,
  onCheckMonitor,
  checkingId,
}) => {
  const upCount = monitors.filter((m) => m.current_status === 'up').length;
  const downCount = monitors.filter((m) => m.current_status === 'down').length;
  const degradedCount = monitors.filter((m) => m.current_status === 'degraded').length;
  const pausedCount = monitors.filter((m) => m.current_status === 'paused').length;

  const activeMonitors = monitors.filter((m) => m.active === 1);
  const uptime24h =
    activeMonitors.length > 0
      ? (
          activeMonitors.reduce((acc, m) => acc + (m.uptime_24h ?? 100), 0) / activeMonitors.length
        ).toFixed(2)
      : '100.00';

  const withLatency = activeMonitors.filter((m) => m.avg_latency_24h > 0);
  const avgLatency =
    withLatency.length > 0
      ? Math.round(withLatency.reduce((acc, m) => acc + m.avg_latency_24h, 0) / withLatency.length)
      : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Top Overview Header */}
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
          Overview
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          Real-time synthetic monitoring across HTTP(s), Keyword, JSON, TCP Port, DNS (1.1.1.1 DoH), and Inbound Push agents.
        </p>
      </div>

      {/* 4 Cloudflare Analytics KPI Cards */}
      <div className="cf-kpi-grid">
        <div className="cf-kpi-card accent-up">
          <div className="cf-kpi-label">
            <span>Operational Services</span>
            <CheckCircle2 size={15} style={{ color: 'var(--status-up)' }} />
          </div>
          <div className="cf-kpi-value mono">
            {upCount} <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>/ {monitors.length}</span>
          </div>
          <div className="cf-kpi-sub">{pausedCount} paused • 1-min edge cron active</div>
        </div>

        <div className={`cf-kpi-card ${downCount > 0 ? 'accent-down' : 'accent-orange'}`}>
          <div className="cf-kpi-label">
            <span>Outages & Retries</span>
            <AlertTriangle
              size={15}
              style={{ color: downCount > 0 ? 'var(--status-down)' : 'var(--cf-orange)' }}
            />
          </div>
          <div className="cf-kpi-value mono" style={{ color: downCount > 0 ? 'var(--status-down)' : undefined }}>
            {downCount}
          </div>
          <div className="cf-kpi-sub">
            {degradedCount > 0 ? `${degradedCount} degraded (retrying)` : 'No degraded targets'}
          </div>
        </div>

        <div className="cf-kpi-card accent-orange">
          <div className="cf-kpi-label">
            <span>24h Availability</span>
            <Activity size={15} style={{ color: 'var(--cf-orange)' }} />
          </div>
          <div className="cf-kpi-value mono">{uptime24h}%</div>
          <div className="cf-kpi-sub">Rolling 24-hour SLA across active checks</div>
        </div>

        <div className="cf-kpi-card accent-blue">
          <div className="cf-kpi-label">
            <span>Avg Edge Response</span>
            <Zap size={15} style={{ color: 'var(--cf-blue)' }} />
          </div>
          <div className="cf-kpi-value mono">{avgLatency} ms</div>
          <div className="cf-kpi-sub">Measured from Cloudflare Worker PoP</div>
        </div>
      </div>

      {/* Empty State or Monitor Health Cards */}
      {monitors.length === 0 ? (
        <div
          className="cf-card"
          style={{
            padding: '48px 24px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: 'var(--cf-orange-soft)',
              color: 'var(--cf-orange)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Server size={24} />
          </div>
          <div style={{ maxWidth: 460 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>
              Start Monitoring Your Sites & Servers
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13.5 }}>
              Use the <strong>&ldquo;+ Add Monitor&rdquo;</strong> button in the top navigation bar to add HTTP/HTTPS endpoints, keyword or JSON API assertions, TCP server ports, DNS records, or inbound Push agents. Everything is stored in Cloudflare D1 within the Free Tier.
            </p>
          </div>
        </div>
      ) : (
        <div className="cf-card">
          <div className="cf-card-header">
            <div>
              <div className="cf-card-title">
                <Globe size={16} style={{ color: 'var(--cf-orange)' }} />
                <span>Monitored Endpoints & Servers</span>
              </div>
              <div className="cf-card-subtitle">
                Click any monitor to inspect full latency charts, heartbeat ticks, and configuration
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {monitors.map((m) => (
              <div
                key={m.id}
                style={{
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8,
                  padding: '14px 16px',
                  background: 'var(--bg-elevated)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 10,
                  }}
                >
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                    onClick={() => onSelectMonitor(m.id)}
                  >
                    <span className={`status-badge ${m.current_status}`}>{m.current_status}</span>
                    <strong style={{ fontSize: 14.5 }}>{m.name}</strong>
                    <span className="protocol-chip mono">{m.type}</span>
                    <span
                      className="mono"
                      style={{ fontSize: 12, color: 'var(--text-secondary)' }}
                    >
                      {m.url_or_host}
                      {m.port ? `:${m.port}` : ''}
                    </span>
                    {m.tags.map((tag) => (
                      <span key={tag} className="tag-chip">
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      24h: <strong>{m.uptime_24h.toFixed(2)}%</strong>
                    </span>
                    {m.last_latency_ms !== null && (
                      <span className="mono" style={{ fontSize: 12, color: 'var(--cf-orange)' }}>
                        {m.last_latency_ms} ms
                      </span>
                    )}
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => onCheckMonitor(m.id)}
                      disabled={checkingId === m.id}
                    >
                      <RefreshCw size={12} />
                      <span>{checkingId === m.id ? 'Probing...' : 'Probe'}</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => onSelectMonitor(m.id)}
                    >
                      Details
                    </button>
                  </div>
                </div>

                <HeartbeatBar heartbeats={m.heartbeats} slots={45} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Incident Timeline */}
      <div className="cf-card">
        <div className="cf-card-header">
          <div>
            <div className="cf-card-title">
              <Clock size={16} style={{ color: 'var(--cf-orange)' }} />
              <span>Recent Incidents</span>
            </div>
            <div className="cf-card-subtitle">
              Logged automatically when a monitor crosses its consecutive retry threshold
            </div>
          </div>
        </div>

        {incidents.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '12px 0' }}>
            No downtime incidents recorded. All monitored systems have remained within SLA.
          </div>
        ) : (
          <div className="cf-table-wrap">
            <table className="cf-table">
              <thead>
                <tr>
                  <th>State</th>
                  <th>Monitor</th>
                  <th>Root Cause / Error</th>
                  <th>Started</th>
                  <th>Resolved / Duration</th>
                </tr>
              </thead>
              <tbody>
                {incidents.slice(0, 15).map((inc) => {
                  const isResolved = inc.resolved_at !== null;
                  const durationSec = isResolved
                    ? Math.max(1, Math.round(((inc.resolved_at as number) - inc.started_at) / 1000))
                    : Math.max(1, Math.round((Date.now() - inc.started_at) / 1000));
                  return (
                    <tr key={inc.id}>
                      <td>
                        <span className={`status-badge ${isResolved ? 'up' : 'down'}`}>
                          {isResolved ? 'Resolved' : 'Ongoing'}
                        </span>
                      </td>
                      <td>
                        <strong>{inc.monitor_name || `Monitor #${inc.monitor_id}`}</strong>
                      </td>
                      <td className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {inc.cause}
                      </td>
                      <td className="mono" style={{ fontSize: 12 }}>
                        {new Date(inc.started_at).toLocaleString()}
                      </td>
                      <td className="mono" style={{ fontSize: 12 }}>
                        {isResolved
                          ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
                          : `Active (${Math.floor(durationSec / 60)}m ${durationSec % 60}s)`}
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
