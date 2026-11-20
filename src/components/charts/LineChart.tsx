import React from 'react';

type ChartDatum = Record<string, number | string | null | undefined>;

interface LineChartProps {
  data: ChartDatum[];
  lines: { key: string; color: string; label: string }[];
  height?: number;
  valueFormatter?: (val: number) => string;
  showLegend?: boolean;
}

function buildSmoothPath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x},${points[0].y}`;

  const d: string[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (i === 0) {
      d.push(`M ${point.x},${point.y}`);
      continue;
    }
    const prev = points[i - 1];
    const next = points[i + 1] || point;
    const cpsX = prev.x + (point.x - prev.x) * 0.45;
    const cpeX = point.x - (next.x - prev.x) * 0.2;
    d.push(`C ${cpsX},${prev.y} ${cpeX},${point.y} ${point.x},${point.y}`);
  }
  return d.join(' ');
}

export default function LineChart({
  data,
  lines,
  height = 200,
  valueFormatter = v => v.toString(),
  showLegend = false,
}: LineChartProps) {
  if (!data.length)
    return (
      <div className="flex items-center justify-center text-muted-foreground h-full">No data</div>
    );

  const padding = 16;
  const axisHeight = 18;
  const chartHeight = height - padding * 2 - axisHeight;
  // Calculate Min/Max
  let maxVal = 0;
  data.forEach(d => {
    lines.forEach(l => {
      const value = d[l.key];
      if (typeof value === 'number' && value > maxVal) maxVal = value;
    });
  });
  // Add 10% headroom
  maxVal = maxVal * 1.1;
  if (maxVal === 0) maxVal = 1;

  const getX = (index: number) => (index / Math.max(1, data.length - 1)) * 100;
  const getY = (val: number) => 100 - (val / maxVal) * 100;
  const firstLabel = typeof data[0]?.label === 'string' ? (data[0]?.label as string) : 'Start';
  const lastLabel =
    typeof data[data.length - 1]?.label === 'string'
      ? (data[data.length - 1]?.label as string)
      : 'End';

  return (
    <div
      className="analytics-line-chart"
      style={{ height: `${height}px`, width: '100%', position: 'relative' }}
    >
      {showLegend && (
        <div className="absolute top-0 right-0 flex gap-4 text-xs">
          {lines.map(l => (
            <div key={l.key} className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ background: l.color }} />
              <span className="text-muted-foreground">{l.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Chart Area */}
      <div className="analytics-line-chart-surface" style={{ height: `${chartHeight}px` }}>
        <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            {lines.map(line => (
              <linearGradient
                key={`${line.key}-gradient`}
                id={`${line.key}-gradient`}
                x1="0"
                x2="0"
                y1="0"
                y2="1"
              >
                <stop offset="0%" stopColor={line.color} stopOpacity="0.35" />
                <stop offset="100%" stopColor={line.color} stopOpacity="0.02" />
              </linearGradient>
            ))}
          </defs>
          {[0, 25, 50, 75, 100].map(p => (
            <line
              key={p}
              x1="0%"
              y1={`${p}%`}
              x2="100%"
              y2={`${p}%`}
              stroke="currentColor"
              strokeOpacity="0.1"
              strokeDasharray="4 6"
            />
          ))}
          {lines.map(line => {
            const points = data.map((d, i) => {
              const x = getX(i);
              const value = d[line.key];
              return typeof value === 'number' ? { x, y: getY(value) } : null;
            });
            const segments: Array<Array<{ x: number; y: number }>> = [];
            let currentSegment: Array<{ x: number; y: number }> = [];
            for (const point of points) {
              if (point) {
                currentSegment.push(point);
              } else if (currentSegment.length > 0) {
                segments.push(currentSegment);
                currentSegment = [];
              }
            }
            if (currentSegment.length > 0) segments.push(currentSegment);
            const populatedSegments = segments;
            const lastPoint = populatedSegments.at(-1)?.at(-1);

            return (
              <g key={line.key}>
                {populatedSegments.map((segment, index) => {
                  const path = buildSmoothPath(segment);
                  const areaPath = `${path} L ${segment.at(-1)!.x},100 L ${segment[0].x},100 Z`;
                  return (
                    <React.Fragment key={`${line.key}-${index}`}>
                      <path d={areaPath} fill={`url(#${line.key}-gradient)`} />
                      <path
                        d={path}
                        fill="none"
                        stroke={line.color}
                        strokeWidth="2.4"
                        vectorEffect="non-scaling-stroke"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </React.Fragment>
                  );
                })}
                {lastPoint && (
                  <>
                    <circle cx={lastPoint.x} cy={lastPoint.y} r="2.6" fill={line.color} />
                    <circle
                      cx={lastPoint.x}
                      cy={lastPoint.y}
                      r="5"
                      fill={line.color}
                      opacity="0.2"
                    />
                  </>
                )}
              </g>
            );
          })}
        </svg>
        <div className="analytics-line-chart-axis">
          <span>{firstLabel}</span>
          <span>{lastLabel}</span>
        </div>
      </div>
    </div>
  );
}
