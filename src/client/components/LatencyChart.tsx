import React, { useMemo, useState } from 'react';
import { Heartbeat } from '../types';

interface LatencyChartProps {
  heartbeats: Heartbeat[];
  range: '24h' | '7d';
  onRangeChange: (range: '24h' | '7d') => void;
}

export const LatencyChart: React.FC<LatencyChartProps> = ({
  heartbeats,
  range,
  onRangeChange,
}) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const width = 840;
  const height = 220;
  const padLeft = 48;
  const padRight = 18;
  const padTop = 18;
  const padBottom = 28;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const stats = useMemo(() => {
    if (heartbeats.length === 0) {
      return { min: 0, max: 100, avg: 0, points: [] as Array<{ x: number; y: number; beat: Heartbeat }> };
    }
    const latencies = heartbeats.map((b) => b.latency_ms);
    const min = Math.min(...latencies);
    const max = Math.max(...latencies, 20);
    const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);

    const upperBound = Math.ceil(max * 1.15);
    const points = heartbeats.map((beat, idx) => {
      const x =
        heartbeats.length === 1
          ? padLeft + plotW / 2
          : padLeft + (idx / (heartbeats.length - 1)) * plotW;
      const y = padTop + plotH - (beat.latency_ms / upperBound) * plotH;
      return { x, y, beat };
    });

    return { min, max: upperBound, avg, points };
  }, [heartbeats, plotW, plotH]);

  const polylinePoints = stats.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath =
    stats.points.length > 1
      ? `M ${stats.points[0].x.toFixed(1)} ${padTop + plotH} L ` +
        stats.points.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ') +
        ` L ${stats.points[stats.points.length - 1].x.toFixed(1)} ${padTop + plotH} Z`
      : '';

  const hoveredPoint = hoverIndex !== null ? stats.points[hoverIndex] : null;

  return (
    <div className="cf-card">
      <div className="cf-card-header">
        <div>
          <div className="cf-card-title">Response Time & Edge Latency</div>
          <div className="cf-card-subtitle">
            {heartbeats.length > 0 ? (
              <span className="mono">
                Min: <strong>{stats.min}ms</strong> • Avg: <strong>{stats.avg}ms</strong> • Peak:{' '}
                <strong>{Math.max(...heartbeats.map((b) => b.latency_ms))}ms</strong>
              </span>
            ) : (
              'No latency samples recorded yet'
            )}
          </div>
        </div>

        <div className="cf-theme-switcher">
          <button
            type="button"
            className={`cf-theme-btn ${range === '24h' ? 'active' : ''}`}
            onClick={() => onRangeChange('24h')}
          >
            Last 24h
          </button>
          <button
            type="button"
            className={`cf-theme-btn ${range === '7d' ? 'active' : ''}`}
            onClick={() => onRangeChange('7d')}
          >
            Last 7d
          </button>
        </div>
      </div>

      {heartbeats.length === 0 ? (
        <div
          style={{
            height: 180,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
            border: '1px dashed var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          Click &ldquo;Check Now&rdquo; to capture your first edge latency sample.
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
            onMouseLeave={() => setHoverIndex(null)}
          >
            <defs>
              <linearGradient id="cfLatencyGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ff5e1f" stopOpacity="0.34" />
                <stop offset="100%" stopColor="#ff5e1f" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Horizontal Grid Lines */}
            {[0, 0.5, 1].map((ratio) => {
              const y = padTop + ratio * plotH;
              const val = Math.round(stats.max * (1 - ratio));
              return (
                <g key={ratio}>
                  <line
                    x1={padLeft}
                    y1={y}
                    x2={width - padRight}
                    y2={y}
                    stroke="var(--border-subtle)"
                    strokeDasharray="3 3"
                  />
                  <text
                    x={padLeft - 8}
                    y={y + 4}
                    textAnchor="end"
                    fill="var(--text-muted)"
                    fontSize="10.5"
                    className="mono"
                  >
                    {val}ms
                  </text>
                </g>
              );
            })}

            {/* Area & Line */}
            {areaPath && <path d={areaPath} fill="url(#cfLatencyGrad)" />}
            {stats.points.length > 1 && (
              <polyline
                fill="none"
                stroke="#ff5e1f"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={polylinePoints}
              />
            )}

            {/* Data Points & Interactive Hit Columns */}
            {stats.points.map((pt, idx) => (
              <g key={pt.beat.id || idx}>
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={hoverIndex === idx ? 4.5 : pt.beat.status === 'down' ? 3.5 : 2}
                  fill={pt.beat.status === 'down' ? 'var(--status-down)' : '#ff5e1f'}
                />
                <rect
                  x={pt.x - Math.max(plotW / stats.points.length / 2, 4)}
                  y={padTop}
                  width={Math.max(plotW / stats.points.length, 8)}
                  height={plotH}
                  fill="transparent"
                  style={{ cursor: 'crosshair' }}
                  onMouseEnter={() => setHoverIndex(idx)}
                />
              </g>
            ))}

            {/* Hover Crosshair */}
            {hoveredPoint && (
              <line
                x1={hoveredPoint.x}
                y1={padTop}
                x2={hoveredPoint.x}
                y2={padTop + plotH}
                stroke="var(--cf-orange)"
                strokeWidth="1"
                strokeDasharray="2 2"
              />
            )}
          </svg>

          {hoveredPoint && (
            <div className="hb-tooltip" style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={`status-dot ${hoveredPoint.beat.status}`} />
                <strong className="mono">{hoveredPoint.beat.latency_ms} ms</strong>
                <span style={{ color: 'var(--text-secondary)' }}>
                  {hoveredPoint.beat.message || 'OK'}
                </span>
              </div>
              <span className="mono" style={{ color: 'var(--text-muted)' }}>
                {new Date(hoveredPoint.beat.timestamp).toLocaleString()}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
