import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Moon,
  RefreshCw,
  Sun,
} from 'lucide-react';
import { api } from '../api';
import { Incident, Monitor, SiteSettings, ThemePreference } from '../types';
import { HeartbeatBar } from './HeartbeatBar';

interface PublicStatusPageProps {
  themePreference: ThemePreference;
  resolvedTheme: 'light' | 'dark';
  onChangeTheme: (pref: ThemePreference) => void;
}

export const PublicStatusPage: React.FC<PublicStatusPageProps> = ({
  themePreference,
  resolvedTheme,
  onChangeTheme,
}) => {
  const [settings, setSettings] = useState<Partial<SiteSettings>>({
    site_title: 'UptimeFlare',
    site_description: 'Cloudflare Edge Infrastructure & Service Status',
  });
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());

  const loadPublicStatus = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getPublicStatus();
      setSettings(data.settings);
      setMonitors(data.monitors);
      setIncidents(data.incidents);
      setLastUpdated(data.generated_at);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load public status page');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPublicStatus();
    const timer = setInterval(loadPublicStatus, 30000);
    return () => clearInterval(timer);
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, Monitor[]>();
    for (const m of monitors) {
      const grp = m.group_name || 'Core Infrastructure';
      const arr = map.get(grp) || [];
      arr.push(m);
      map.set(grp, arr);
    }
    return Array.from(map.entries());
  }, [monitors]);

  const downCount = monitors.filter((m) => m.current_status === 'down').length;
  const degradedCount = monitors.filter((m) => m.current_status === 'degraded').length;
  const bannerState = downCount > 0 ? 'down' : degradedCount > 0 ? 'degraded' : 'up';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-canvas)' }}>
      {/* Top Status Bar */}
      <header className="cf-navbar">
        <div className="cf-navbar-left">
          <div className="cf-brand">
            <div className="cf-brand-logo">
              <Activity size={18} />
            </div>
            <div className="cf-brand-text">
              <div className="cf-brand-title">
                <span>{settings.site_title || 'UptimeFlare'}</span>
                <span className="cf-brand-tag">Public Status</span>
              </div>
              <span className="cf-brand-subtitle">
                {settings.site_description || 'Live Cloudflare Edge Uptime'}
              </span>
            </div>
          </div>
        </div>

        <div className="cf-navbar-right">
          <div className="cf-theme-switcher">
            <button
              type="button"
              className={`cf-theme-btn ${themePreference === 'auto' ? 'active' : ''}`}
              onClick={() => onChangeTheme('auto')}
              title={`Auto theme by local time (6:00 AM–7:00 PM Light, 7:00 PM–6:00 AM Dark) • Currently ${
                resolvedTheme === 'dark' ? 'Dark' : 'Light'
              }`}
              aria-label="Auto theme by local time"
            >
              <Clock size={14} />
            </button>
            <button
              type="button"
              className={`cf-theme-btn ${themePreference === 'light' ? 'active' : ''}`}
              onClick={() => onChangeTheme('light')}
              title="Light mode"
              aria-label="Light mode"
            >
              <Sun size={14} />
            </button>
            <button
              type="button"
              className={`cf-theme-btn ${themePreference === 'dark' ? 'active' : ''}`}
              onClick={() => onChangeTheme('dark')}
              title="Dark mode"
              aria-label="Dark mode"
            >
              <Moon size={14} />
            </button>
          </div>

          <button type="button" className="btn btn-sm" onClick={loadPublicStatus}>
            <RefreshCw size={13} />
            <span>Refresh</span>
          </button>

          <a href="/" className="btn btn-sm" style={{ textDecoration: 'none' }}>
            <ArrowLeft size={13} />
            <span>Admin Dashboard</span>
          </a>
        </div>
      </header>

      <main className="public-status-wrapper">
        {error ? (
          <div className="cf-card" style={{ color: 'var(--status-down)', textAlign: 'center' }}>
            {error}
          </div>
        ) : (
          <>
            {/* Global Operational Banner */}
            <div className={`public-banner ${bannerState}`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 18 }}>
                {bannerState === 'up' ? (
                  <CheckCircle2 size={24} />
                ) : (
                  <AlertTriangle size={24} />
                )}
                <span>
                  {bannerState === 'up'
                    ? 'All Systems Operational'
                    : bannerState === 'degraded'
                      ? 'Partial Performance Degradation'
                      : `${downCount} System${downCount > 1 ? 's' : ''} Experiencing Outage`}
                </span>
              </div>
              <span className="mono" style={{ fontSize: 12, opacity: 0.85 }}>
                Updated {new Date(lastUpdated).toLocaleTimeString()}
              </span>
            </div>

            {/* Optional Admin Announcement Banner */}
            {settings.public_announcement && (
              <div
                className="cf-card"
                style={{
                  borderLeft: '4px solid var(--cf-orange)',
                  background: 'var(--cf-orange-soft)',
                }}
              >
                <strong style={{ color: 'var(--cf-orange)' }}>Service Notice: </strong>
                <span>{settings.public_announcement}</span>
              </div>
            )}

            {/* Grouped Public Monitors */}
            {loading && monitors.length === 0 ? (
              <div className="cf-card" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                Loading status telemetry...
              </div>
            ) : grouped.length === 0 ? (
              <div className="cf-card" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                No public monitors have been published yet.
              </div>
            ) : (
              grouped.map(([groupName, groupMonitors]) => (
                <div key={groupName} className="cf-card">
                  <div className="cf-card-header">
                    <div className="cf-card-title">{groupName}</div>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {groupMonitors.filter((m) => m.current_status === 'up').length} /{' '}
                      {groupMonitors.length} Operational
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {groupMonitors.map((m) => (
                      <div
                        key={m.id}
                        style={{
                          paddingBottom: 14,
                          borderBottom: '1px solid var(--border-subtle)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 12,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span className={`status-dot ${m.current_status}`} />
                            <strong>{m.name}</strong>
                            <span className="protocol-chip mono">{m.type}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            {m.last_latency_ms !== null && (
                              <span
                                className="mono"
                                style={{ fontSize: 12, color: 'var(--text-secondary)' }}
                              >
                                {m.last_latency_ms} ms
                              </span>
                            )}
                            <span className={`cf-uptime-pill mono ${m.current_status}`}>
                              {m.uptime_24h.toFixed(2)}% (24h)
                            </span>
                          </div>
                        </div>

                        <HeartbeatBar heartbeats={m.heartbeats} slots={60} />
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}

            {/* Recent Public Incidents */}
            <div className="cf-card">
              <div className="cf-card-header">
                <div className="cf-card-title">Past Incidents</div>
              </div>
              {incidents.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                  No recent incidents reported across public monitors.
                </div>
              ) : (
                <div className="cf-table-wrap">
                  <table className="cf-table">
                    <thead>
                      <tr>
                        <th>Status</th>
                        <th>Service</th>
                        <th>Details</th>
                        <th>Started</th>
                        <th>Resolved</th>
                      </tr>
                    </thead>
                    <tbody>
                      {incidents.map((inc) => (
                        <tr key={inc.id}>
                          <td>
                            <span
                              className={`status-badge ${inc.resolved_at ? 'up' : 'down'}`}
                            >
                              {inc.resolved_at ? 'Resolved' : 'Investigating'}
                            </span>
                          </td>
                          <td>
                            <strong>{inc.monitor_name}</strong>
                          </td>
                          <td className="mono" style={{ fontSize: 12 }}>
                            {inc.cause}
                          </td>
                          <td className="mono" style={{ fontSize: 12 }}>
                            {new Date(inc.started_at).toLocaleString()}
                          </td>
                          <td className="mono" style={{ fontSize: 12 }}>
                            {inc.resolved_at
                              ? new Date(inc.resolved_at).toLocaleString()
                              : 'Ongoing'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
};
