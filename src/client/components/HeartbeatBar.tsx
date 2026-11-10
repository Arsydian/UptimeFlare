import React, { useState } from 'react';
import { Heartbeat } from '../types';

interface HeartbeatBarProps {
  heartbeats: Heartbeat[];
  slots?: number;
  compact?: boolean;
}

export const HeartbeatBar: React.FC<HeartbeatBarProps> = ({
  heartbeats,
  slots = 60,
  compact = false,
}) => {
  const [hovered, setHovered] = useState<Heartbeat | null>(null);

  const recent = heartbeats.slice(-slots);
  const emptyCount = Math.max(0, slots - recent.length);
  const padded: Array<Heartbeat | null> = [
    ...Array.from({ length: emptyCount }, () => null),
    ...recent,
  ];

  return (
    <div className="hb-container" onMouseLeave={() => setHovered(null)}>
      <div className={`hb-ticks ${compact ? 'compact' : ''}`}>
        {padded.map((beat, idx) => {
          if (!beat) {
            return <div key={`empty-${idx}`} className="hb-tick" />;
          }
          return (
            <div
              key={beat.id || idx}
              className={`hb-tick ${beat.status}`}
              onMouseEnter={() => !compact && setHovered(beat)}
              title={
                compact
                  ? `${beat.status.toUpperCase()} • ${beat.latency_ms}ms • ${new Date(
                      beat.timestamp
                    ).toLocaleTimeString()}`
                  : undefined
              }
            />
          );
        })}
      </div>

      {!compact && (
        <>
          {hovered ? (
            <div className="hb-tooltip">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={`status-dot ${hovered.status}`} />
                <strong style={{ textTransform: 'uppercase' }}>{hovered.status}</strong>
                <span className="mono" style={{ color: 'var(--text-secondary)' }}>
                  {hovered.message || (hovered.status_code ? `HTTP ${hovered.status_code}` : 'OK')}
                </span>
              </div>
              <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ color: 'var(--cf-orange)', fontWeight: 600 }}>
                  {hovered.latency_ms} ms
                </span>
                <span style={{ color: 'var(--text-muted)' }}>
                  {new Date(hovered.timestamp).toLocaleString()}
                </span>
              </div>
            </div>
          ) : (
            <div className="hb-legend">
              <span>{slots} check intervals</span>
              <span>Hover any bar to inspect edge check telemetry</span>
              <span>Now</span>
            </div>
          )}
        </>
      )}
    </div>
  );
};
