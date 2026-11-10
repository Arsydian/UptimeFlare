import React from 'react';
import {
  Activity,
  Bell,
  Clock,
  ExternalLink,
  Moon,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import { Monitor, SiteSettings, ThemePreference, ZeroTrustIdentity } from '../types';

interface NavbarProps {
  settings: SiteSettings;
  identity: ZeroTrustIdentity | null;
  monitors: Monitor[];
  themePreference: ThemePreference;
  resolvedTheme: 'light' | 'dark';
  onChangeTheme: (pref: ThemePreference) => void;
  onSelectOverview: () => void;
  onOpenAddMonitor: () => void;
  onOpenNotifications: () => void;
  onOpenSettings: () => void;
  onRunAllChecks: () => void;
  isCheckingAll: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  settings,
  identity,
  monitors,
  themePreference,
  resolvedTheme,
  onChangeTheme,
  onSelectOverview,
  onOpenAddMonitor,
  onOpenNotifications,
  onOpenSettings,
  onRunAllChecks,
  isCheckingAll,
}) => {
  const upCount = monitors.filter((m) => m.current_status === 'up').length;
  const downCount = monitors.filter((m) => m.current_status === 'down').length;
  const degradedCount = monitors.filter((m) => m.current_status === 'degraded').length;

  const overallState =
    downCount > 0 ? 'down' : degradedCount > 0 ? 'degraded' : monitors.length > 0 ? 'up' : 'paused';

  const overallLabel =
    downCount > 0
      ? `${downCount} Service${downCount > 1 ? 's' : ''} Down`
      : degradedCount > 0
        ? `${degradedCount} Degraded`
        : monitors.length > 0
          ? `All ${upCount} Operational`
          : 'No Monitors Yet';

  return (
    <header className="cf-navbar">
      <div className="cf-navbar-left">
        <div className="cf-brand" onClick={onSelectOverview} title="Return to Fleet Overview">
          <div className="cf-brand-logo">
            <Activity size={18} />
          </div>
          <div className="cf-brand-text">
            <div className="cf-brand-title">
              <span>{settings.site_title || 'UptimeFlare'}</span>
              <span className="cf-brand-tag">Workers Edge</span>
            </div>
            <span className="cf-brand-subtitle">Cloudflare D1 • Zero Trust Protected</span>
          </div>
        </div>

        <div className="cf-nav-divider" />

        <div className="cf-global-health-pill" onClick={onSelectOverview} style={{ cursor: 'pointer' }}>
          <span className={`status-dot ${overallState}`} />
          <span className="tabular">{overallLabel}</span>
        </div>
      </div>

      <div className="cf-navbar-right">
        {/* 3-Mode Dynamic Theme Switcher: Auto (Local Time) / Light / Dark */}
        <div
          className="cf-theme-switcher"
          title={`Current active theme: ${resolvedTheme.toUpperCase()} (${
            themePreference === 'auto'
              ? 'Auto by local time: 6am-7pm Light / 7pm-6am Dark'
              : 'Manual override'
          })`}
        >
          <button
            type="button"
            id="theme-btn-auto"
            className={`cf-theme-btn ${themePreference === 'auto' ? 'active' : ''}`}
            onClick={() => onChangeTheme('auto')}
          >
            <Clock size={13} />
            <span>Auto ({resolvedTheme === 'dark' ? 'Night' : 'Day'})</span>
          </button>
          <button
            type="button"
            id="theme-btn-light"
            className={`cf-theme-btn ${themePreference === 'light' ? 'active' : ''}`}
            onClick={() => onChangeTheme('light')}
          >
            <Sun size={13} />
            <span>Light</span>
          </button>
          <button
            type="button"
            id="theme-btn-dark"
            className={`cf-theme-btn ${themePreference === 'dark' ? 'active' : ''}`}
            onClick={() => onChangeTheme('dark')}
          >
            <Moon size={13} />
            <span>Dark</span>
          </button>
        </div>

        {/* Zero Trust Badge */}
        {identity && (
          <div
            className="cf-zt-badge"
            title={
              identity.mode === 'cloudflare_zero_trust'
                ? `Protected by Cloudflare Zero Trust (${identity.email})`
                : `Identity: ${identity.email} (${identity.mode})`
            }
          >
            <ShieldCheck size={14} />
            <span>
              {identity.mode === 'cloudflare_zero_trust' ? 'Zero Trust' : 'Zero Trust Ready'}
            </span>
          </div>
        )}

        <button
          type="button"
          id="btn-run-all-checks"
          className="btn btn-sm"
          onClick={onRunAllChecks}
          disabled={isCheckingAll}
          title="Trigger immediate check cycle across due monitors"
        >
          <RefreshCw size={14} className={isCheckingAll ? 'spin' : ''} />
          <span>{isCheckingAll ? 'Checking...' : 'Check All'}</span>
        </button>

        <a
          href="/status"
          id="link-public-status"
          className="btn btn-sm"
          style={{ textDecoration: 'none' }}
          title="View Public Read-Only Status Page"
        >
          <ExternalLink size={14} />
          <span>Status Page</span>
        </a>

        <button
          type="button"
          id="btn-open-notifications"
          className="btn btn-sm"
          onClick={onOpenNotifications}
        >
          <Bell size={14} />
          <span>Alerts</span>
        </button>

        <button
          type="button"
          id="btn-open-settings"
          className="btn btn-sm"
          onClick={onOpenSettings}
        >
          <Settings size={14} />
          <span>Settings</span>
        </button>

        <button
          type="button"
          id="btn-add-monitor"
          className="btn btn-primary btn-sm"
          onClick={onOpenAddMonitor}
        >
          <Plus size={15} />
          <span>Add Monitor</span>
        </button>
      </div>
    </header>
  );
};
