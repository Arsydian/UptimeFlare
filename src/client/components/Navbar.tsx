import React from 'react';
import {
  Activity,
  Clock,
  ExternalLink,
  Moon,
  Plus,
  RefreshCw,
  Settings,
  Sun,
} from 'lucide-react';
import { Monitor, SiteSettings, ThemePreference } from '../types';

interface NavbarProps {
  settings: SiteSettings;
  monitors: Monitor[];
  themePreference: ThemePreference;
  resolvedTheme: 'light' | 'dark';
  onChangeTheme: (pref: ThemePreference) => void;
  onSelectOverview: () => void;
  onOpenAddMonitor: () => void;
  onOpenSettings: () => void;
  onRunAllChecks: () => void;
  isCheckingAll: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  settings,
  monitors,
  themePreference,
  resolvedTheme,
  onChangeTheme,
  onSelectOverview,
  onOpenAddMonitor,
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
        <div className="cf-brand" onClick={onSelectOverview} title="Return to Overview">
          <div className="cf-brand-logo">
            <Activity size={18} />
          </div>
          <div className="cf-brand-text">
            <div className="cf-brand-title">
              <span>{settings.site_title || 'UptimeFlare'}</span>
            </div>
          </div>
        </div>

        <div className="cf-nav-divider" />

        <div className="cf-global-health-pill" onClick={onSelectOverview} style={{ cursor: 'pointer' }}>
          <span className={`status-dot ${overallState}`} />
          <span className="tabular">{overallLabel}</span>
        </div>
      </div>

      <div className="cf-navbar-right">
        {/* Icon-Only 3-Mode Theme Switcher: Clock (Auto) / Sun (Light) / Moon (Dark) */}
        <div className="cf-theme-switcher">
          <button
            type="button"
            id="theme-btn-auto"
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
            id="theme-btn-light"
            className={`cf-theme-btn ${themePreference === 'light' ? 'active' : ''}`}
            onClick={() => onChangeTheme('light')}
            title="Light mode"
            aria-label="Light mode"
          >
            <Sun size={14} />
          </button>
          <button
            type="button"
            id="theme-btn-dark"
            className={`cf-theme-btn ${themePreference === 'dark' ? 'active' : ''}`}
            onClick={() => onChangeTheme('dark')}
            title="Dark mode"
            aria-label="Dark mode"
          >
            <Moon size={14} />
          </button>
        </div>

        <button
          type="button"
          id="btn-run-all-checks"
          className="btn btn-sm"
          onClick={onRunAllChecks}
          disabled={isCheckingAll}
          title="Trigger an immediate manual check of all active monitors"
        >
          <RefreshCw size={14} className={isCheckingAll ? 'spin' : ''} />
          <span>{isCheckingAll ? 'Checking...' : 'Check All'}</span>
        </button>

        {settings.public_status_enabled === 'true' && (
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
        )}

        <button
          type="button"
          id="btn-open-settings"
          className="btn btn-sm"
          onClick={onOpenSettings}
          title="Settings, Alerts & Backup"
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
