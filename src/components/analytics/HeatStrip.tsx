interface HeatStripDatum {
  key: string;
  label: string;
  count: number;
}

interface HeatStripProps {
  data: HeatStripDatum[];
  maxValue: number;
  height?: number;
}

function getCellColor(intensity: number) {
  const clamped = Math.max(0, Math.min(1, intensity));
  const alpha = 0.12 + clamped * 0.7;
  return `rgba(59, 130, 246, ${alpha.toFixed(2)})`;
}

export default function HeatStrip({ data, maxValue, height = 24 }: HeatStripProps) {
  if (!data.length) {
    return (
      <div className="analytics-heat-strip-empty" style={{ height: `${height}px` }}>
        No data
      </div>
    );
  }

  const safeMax = Math.max(1, maxValue);
  const startLabel = data[0]?.label ?? '';
  const endLabel = data[data.length - 1]?.label ?? '';

  return (
    <div className="analytics-heat-strip">
      <div className="analytics-heat-strip-row" style={{ height: `${height}px` }}>
        {data.map(entry => {
          const intensity = entry.count / safeMax;
          return (
            <span
              key={entry.key}
              className="analytics-heat-strip-cell"
              style={{ backgroundColor: getCellColor(intensity) }}
              title={`${entry.label}: ${entry.count}`}
            />
          );
        })}
      </div>
      <div className="analytics-heat-strip-axis">
        <span>{startLabel}</span>
        <span>{endLabel}</span>
      </div>
    </div>
  );
}
