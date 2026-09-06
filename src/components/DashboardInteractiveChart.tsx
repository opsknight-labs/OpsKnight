'use client';

import { useState } from 'react';
import BarChart from '@/components/analytics/BarChart';

type InteractiveChartProps = {
  data: Array<{ key: string; label: string; count: number }>;
  maxValue: number;
  title: string;
  onDataPointClick?: (dataPoint: { key: string; label: string; count: number }) => void;
};

export default function DashboardInteractiveChart({ 
  data, 
  maxValue, 
  title,
  onDataPointClick 
}: InteractiveChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <div className="glass-panel" style={{ background: 'white', padding: '1.5rem' }}>
      <h3 style={{ fontSize: '1.1rem', fontWeight: '700', marginBottom: '1rem' }}>{title}</h3>
      {data.some(t => t.count > 0) ? (
        <div style={{ position: 'relative' }}>
          <BarChart data={data} maxValue={maxValue} height={120} showValues={false} />
          {hoveredIndex !== null && data[hoveredIndex] && (
            <div
              style={{
                position: 'absolute',
                top: '-2.5rem',
                left: `${(hoveredIndex / data.length) * 100}%`,
                transform: 'translateX(-50%)',
                background: 'rgba(0, 0, 0, 0.85)',
                color: 'white',
                padding: '0.4rem 0.6rem',
                borderRadius: '6px',
                fontSize: '0.75rem',
                fontWeight: '600',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                zIndex: 10
              }}
            >
              {data[hoveredIndex].label}: {data[hoveredIndex].count} incident{data[hoveredIndex].count !== 1 ? 's' : ''}
            </div>
          )}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${data.length}, 1fr)`,
              gap: '2px',
              marginTop: '0.5rem',
              height: '120px',
              position: 'absolute',
              top: '2.5rem',
              left: 0,
              right: 0,
              pointerEvents: 'auto'
            }}
          >
            {data.map((item, index) => (
              <div
                key={item.key}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
                onClick={() => onDataPointClick && onDataPointClick(item)}
                style={{
                  cursor: onDataPointClick ? 'pointer' : 'default',
                  transition: 'background 0.2s ease'
                }}
                title={`${item.label}: ${item.count} incidents`}
              />
            ))}
          </div>
        </div>
      ) : (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          No incidents in this period
        </div>
      )}
    </div>
  );
}

