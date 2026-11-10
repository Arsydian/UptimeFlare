import React, { useCallback, useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { api } from './api';
import { FleetOverview } from './components/FleetOverview';
import { MonitorDetail } from './components/MonitorDetail';
import { MonitorModal } from './components/MonitorModal';
import { Navbar } from './components/Navbar';
import { NotificationsModal } from './components/NotificationsModal';
import { PublicStatusPage } from './components/PublicStatusPage';
import { SettingsModal } from './components/SettingsModal';
import { Sidebar } from './components/Sidebar';
import { useTheme } from './hooks/useTheme';
import {
  Incident,
  Monitor,
  NotificationChannel,
  SiteSettings,
  ZeroTrustIdentity,
} from './types';

const DEFAULT_SETTINGS: SiteSettings = {
  site_title: 'UptimeFlare',
  site_description: 'Cloudflare Edge Infrastructure & Service Status',
  public_status_enabled: 'true',
  public_announcement: '',
  public_announcement_type: 'info',
  retention_days: '30',
};

export const App: React.FC = () => {
  const { preference, resolvedTheme, setPreference } = useTheme();
  const isStatusRoute = window.location.pathname.startsWith('/status');

  const [identity, setIdentity] = useState<ZeroTrustIdentity | null>(null);
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SETTINGS);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [notifications, setNotifications] = useState<NotificationChannel[]>([]);
  const [selectedMonitorId, setSelectedMonitorId] = useState<number | null>(null);

  const [loading, setLoading] = useState(!isStatusRoute);
  const [authError, setAuthError] = useState<string | null>(null);
  const [dbBindingError, setDbBindingError] = useState<string | null>(null);
  const [checkingId, setCheckingId] = useState<number | null>(null);
  const [isCheckingAll, setIsCheckingAll] = useState(false);

  // Modals
  const [monitorModalState, setMonitorModalState] = useState<{
    open: boolean;
    monitor?: Monitor | null;
    isClone?: boolean;
  }>({ open: false });
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const fetchDashboard = useCallback(async () => {
    if (isStatusRoute) return;
    try {
      const data = await api.getDashboard();
      setIdentity(data.identity);
      setSettings(data.settings);
      setMonitors(data.monitors);
      setIncidents(data.incidents);
      setNotifications(data.notifications);
      setAuthError(null);
      setDbBindingError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load dashboard';
      if (msg.includes('uf_db_BINDING_MISSING') || msg.includes("D1 database binding 'uf_db'")) {
        setDbBindingError(msg);
      } else if (msg.toLowerCase().includes('unauthorized') || msg.includes('401')) {
        setAuthError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [isStatusRoute]);

  useEffect(() => {
    if (isStatusRoute) return;
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 15000);
    return () => clearInterval(interval);
  }, [fetchDashboard, isStatusRoute]);

  if (isStatusRoute) {
    return (
      <PublicStatusPage
        themePreference={preference}
        resolvedTheme={resolvedTheme}
        onChangeTheme={setPreference}
      />
    );
  }

  if (dbBindingError) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <div
          className="cf-card"
          style={{
            maxWidth: 520,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            borderTop: '3px solid var(--cf-orange)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ShieldAlert size={28} style={{ color: 'var(--cf-orange)', flexShrink: 0 }} />
            <h1 style={{ fontSize: 18, fontWeight: 700 }}>
              Connect Cloudflare D1 Database Binding
            </h1>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13.5, lineHeight: 1.55 }}>
            Your UptimeFlare Worker is live, but needs a Cloudflare D1 database bound to{' '}
            <code className="mono">uf_db</code>.
          </p>
          <ol
            style={{
              paddingLeft: 20,
              color: 'var(--text-secondary)',
              fontSize: 13,
              lineHeight: 1.7,
              margin: 0,
            }}
          >
            <li>
              In the Cloudflare Dashboard, go to{' '}
              <strong>Compute (Workers) &gt; Workers &amp; Pages &gt; uptimeflare</strong>.
            </li>
            <li>
              Open <strong>Settings &gt; Bindings &gt; Add binding &gt; D1 database</strong>.
            </li>
            <li>
              Set <strong>Variable name</strong> to <code className="mono">uf_db</code>, select or
              create <code className="mono">uf_db</code>, and click{' '}
              <strong>Deploy</strong>.
            </li>
          </ol>
          <button type="button" className="btn btn-primary" onClick={fetchDashboard}>
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  if (authError) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <div
          className="cf-card"
          style={{
            maxWidth: 460,
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 14,
            borderTop: '3px solid var(--cf-orange)',
          }}
        >
          <ShieldAlert size={36} style={{ color: 'var(--cf-orange)' }} />
          <h1 style={{ fontSize: 19, fontWeight: 700 }}>Cloudflare Zero Trust Required</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13.5 }}>{authError}</p>
          <a href="/status" className="btn btn-primary">
            View Public Status Page (/status)
          </a>
        </div>
      </div>
    );
  }

  const selectedMonitor = monitors.find((m) => m.id === selectedMonitorId) || null;

  const handleSaveMonitor = async (payload: Record<string, unknown>, editId?: number) => {
    if (editId) {
      const { monitor } = await api.updateMonitor(editId, payload);
      await fetchDashboard();
      if (monitor) setSelectedMonitorId(monitor.id);
    } else {
      const { monitor } = await api.createMonitor(payload);
      await fetchDashboard();
      if (monitor) setSelectedMonitorId(monitor.id);
    }
  };

  const handleCheckMonitor = async (id: number) => {
    setCheckingId(id);
    try {
      await api.checkMonitorNow(id);
      await fetchDashboard();
    } finally {
      setCheckingId(null);
    }
  };

  const handleTogglePause = async (id: number) => {
    await api.toggleMonitor(id);
    await fetchDashboard();
  };

  const handleDeleteMonitor = async (id: number) => {
    await api.deleteMonitor(id);
    if (selectedMonitorId === id) {
      setSelectedMonitorId(null);
    }
    await fetchDashboard();
  };

  const handleRunAllChecks = async () => {
    setIsCheckingAll(true);
    try {
      await api.runAllChecksNow();
      await fetchDashboard();
    } finally {
      setIsCheckingAll(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar
        settings={settings}
        identity={identity}
        monitors={monitors}
        themePreference={preference}
        resolvedTheme={resolvedTheme}
        onChangeTheme={setPreference}
        onSelectOverview={() => setSelectedMonitorId(null)}
        onOpenAddMonitor={() => setMonitorModalState({ open: true, monitor: null })}
        onOpenNotifications={() => setNotificationsOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onRunAllChecks={handleRunAllChecks}
        isCheckingAll={isCheckingAll}
      />

      <div className="cf-workspace">
        <Sidebar
          monitors={monitors}
          selectedMonitorId={selectedMonitorId}
          onSelectMonitor={setSelectedMonitorId}
          onOpenAddMonitor={() => setMonitorModalState({ open: true, monitor: null })}
        />

        <main className="cf-main">
          {loading ? (
            <div className="cf-card" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
              Loading Cloudflare Edge monitors...
            </div>
          ) : selectedMonitor ? (
            <MonitorDetail
              monitor={selectedMonitor}
              onCheckNow={handleCheckMonitor}
              onTogglePause={handleTogglePause}
              onEdit={(m) => setMonitorModalState({ open: true, monitor: m, isClone: false })}
              onClone={(m) => setMonitorModalState({ open: true, monitor: m, isClone: true })}
              onDelete={handleDeleteMonitor}
              isChecking={checkingId === selectedMonitor.id}
            />
          ) : (
            <FleetOverview
              monitors={monitors}
              incidents={incidents}
              onSelectMonitor={(id) => setSelectedMonitorId(id)}
              onOpenAddMonitor={() => setMonitorModalState({ open: true, monitor: null })}
              onCheckMonitor={handleCheckMonitor}
              checkingId={checkingId}
            />
          )}
        </main>
      </div>

      {monitorModalState.open && (
        <MonitorModal
          initialMonitor={monitorModalState.monitor}
          isClone={monitorModalState.isClone}
          notifications={notifications}
          onClose={() => setMonitorModalState({ open: false })}
          onSave={handleSaveMonitor}
        />
      )}

      {notificationsOpen && (
        <NotificationsModal
          channels={notifications}
          onClose={() => setNotificationsOpen(false)}
          onRefresh={fetchDashboard}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onRefresh={fetchDashboard}
        />
      )}
    </div>
  );
};
