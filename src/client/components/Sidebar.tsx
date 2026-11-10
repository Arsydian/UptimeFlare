import React, { useMemo, useState } from 'react';
import { LayoutGrid, Plus, Search } from 'lucide-react';
import { Monitor } from '../types';
import { HeartbeatBar } from './HeartbeatBar';

interface SidebarProps {
  monitors: Monitor[];
  selectedMonitorId: number | null;
  onSelectMonitor: (id: number | null) => void;
  onOpenAddMonitor: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  monitors,
  selectedMonitorId,
  onSelectMonitor,
  onOpenAddMonitor,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'up' | 'down' | 'paused'>('all');

  const filtered = useMemo(() => {
    return monitors.filter((m) => {
      const matchesSearch =
        !search.trim() ||
        m.name.toLowerCase().includes(search.toLowerCase()) ||
        m.url_or_host.toLowerCase().includes(search.toLowerCase()) ||
        m.group_name.toLowerCase().includes(search.toLowerCase()) ||
        m.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()));

      if (!matchesSearch) return false;
      if (statusFilter === 'all') return true;
      if (statusFilter === 'down') {
        return m.current_status === 'down' || m.current_status === 'degraded';
      }
      return m.current_status === statusFilter;
    });
  }, [monitors, search, statusFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, Monitor[]>();
    for (const m of filtered) {
      const grp = m.group_name || 'Core Infrastructure';
      const list = map.get(grp) || [];
      list.push(m);
      map.set(grp, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <aside className="cf-sidebar">
      <div className="cf-sidebar-header">
        <button
          type="button"
          id="btn-fleet-overview"
          className={`cf-monitor-item ${selectedMonitorId === null ? 'selected' : ''}`}
          onClick={() => onSelectMonitor(null)}
          style={{ padding: '8px 10px' }}
        >
          <div className="cf-monitor-item-left">
            <LayoutGrid size={16} style={{ color: 'var(--cf-orange)' }} />
            <div className="cf-monitor-item-info">
              <div className="cf-monitor-item-name">Fleet Overview</div>
              <div className="cf-monitor-item-meta">All monitors & edge telemetry</div>
            </div>
          </div>
          <span className="protocol-chip mono">{monitors.length}</span>
        </button>

        <div className="cf-search-box">
          <Search size={14} />
          <input
            type="text"
            id="sidebar-search-input"
            className="cf-search-input"
            placeholder="Filter sites, hosts, or tags..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="cf-filter-pills">
          {(['all', 'up', 'down', 'paused'] as const).map((st) => (
            <button
              key={st}
              type="button"
              className={`cf-filter-pill ${statusFilter === st ? 'active' : ''}`}
              onClick={() => setStatusFilter(st)}
            >
              {st === 'all' ? 'All' : st.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="cf-sidebar-list">
        {grouped.length === 0 ? (
          <div
            style={{
              padding: '28px 16px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <div>No monitors match your filter.</div>
            <button type="button" className="btn btn-primary btn-sm" onClick={onOpenAddMonitor}>
              <Plus size={14} />
              <span>Add First Monitor</span>
            </button>
          </div>
        ) : (
          grouped.map(([groupName, items]) => (
            <div key={groupName} className="cf-group-section">
              <div className="cf-group-title">
                <span>{groupName}</span>
                <span className="mono">{items.length}</span>
              </div>

              {items.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`cf-monitor-item ${selectedMonitorId === m.id ? 'selected' : ''}`}
                  onClick={() => onSelectMonitor(m.id)}
                >
                  <div className="cf-monitor-item-left">
                    <span className={`status-dot ${m.current_status}`} />
                    <div className="cf-monitor-item-info">
                      <div className="cf-monitor-item-name">{m.name}</div>
                      <div className="cf-monitor-item-meta">
                        <span className="mono" style={{ textTransform: 'uppercase' }}>
                          {m.type}
                        </span>
                        {m.last_latency_ms !== null && m.current_status !== 'paused' && (
                          <span className="mono">• {m.last_latency_ms}ms</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="cf-monitor-item-right">
                    <span className={`cf-uptime-pill mono ${m.current_status}`}>
                      {m.uptime_24h.toFixed(1)}%
                    </span>
                    <HeartbeatBar heartbeats={m.heartbeats} slots={18} compact />
                  </div>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </aside>
  );
};
