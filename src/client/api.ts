import { DashboardPayload, Heartbeat, Incident, Monitor, SiteSettings } from './types';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed with HTTP ${res.status}`);
  }
  return data as T;
}

export const api = {
  getDashboard: () => requestJson<DashboardPayload>('/api/dashboard'),

  getPublicStatus: () =>
    requestJson<{
      settings: Partial<SiteSettings>;
      monitors: Monitor[];
      incidents: Incident[];
      generated_at: number;
    }>('/api/public/status'),

  getMonitorHistory: (id: number, range: '24h' | '7d') =>
    requestJson<{ heartbeats: Heartbeat[]; incidents: Incident[] }>(
      `/api/monitors/${id}/history?range=${range}`
    ),

  probeMonitor: (payload: Record<string, unknown>) =>
    requestJson<{ status: 'up' | 'down'; latency_ms: number; status_code: number | null; message: string }>(
      '/api/monitors/probe',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  createMonitor: (payload: Record<string, unknown>) =>
    requestJson<{ monitor: Monitor }>('/api/monitors', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateMonitor: (id: number, payload: Record<string, unknown>) =>
    requestJson<{ monitor: Monitor }>(`/api/monitors/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  toggleMonitor: (id: number) =>
    requestJson<{ monitor: Monitor }>(`/api/monitors/${id}/toggle`, {
      method: 'PATCH',
    }),

  checkMonitorNow: (id: number) =>
    requestJson<{ monitor: Monitor }>(`/api/monitors/${id}/check`, {
      method: 'POST',
    }),

  deleteMonitor: (id: number) =>
    requestJson<{ deleted: boolean }>(`/api/monitors/${id}`, {
      method: 'DELETE',
    }),

  runAllChecksNow: () =>
    requestJson<{ checkedCount: number }>('/api/cron/run', {
      method: 'POST',
    }),

  createNotification: (payload: Record<string, unknown>) =>
    requestJson<{ id: number }>('/api/notifications', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateNotification: (id: number, payload: Record<string, unknown>) =>
    requestJson<{ updated: boolean }>(`/api/notifications/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteNotification: (id: number) =>
    requestJson<{ deleted: boolean }>(`/api/notifications/${id}`, {
      method: 'DELETE',
    }),

  testNotification: (payload: Record<string, unknown>) =>
    requestJson<{ ok: boolean }>('/api/notifications/test', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateSettings: (payload: Partial<SiteSettings>) =>
    requestJson<{ settings: SiteSettings }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  exportBackup: () => requestJson<Record<string, unknown>>('/api/backup/export'),

  importBackup: (payload: Record<string, unknown>) =>
    requestJson<{ ok: boolean; imported_monitors: number; imported_channels: number }>(
      '/api/backup/import',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
};
