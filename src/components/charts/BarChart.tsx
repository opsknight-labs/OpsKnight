interface BarChartData {
  key: string;
  label: string;
  count: number | null;
}

interface BarChartProps {
  data: BarChartData[];
  maxValue: number;
  height?: number;
  showValues?: boolean;
  showLabels?: boolean;
  labelEvery?: number;
}

export default function BarChart({
  data,
  maxValue,
  height = 160,
  showValues = false,
  showLabels = true,
  labelEvery = 1,
}: BarChartProps) {
  return (
    <div className="analytics-bar-chart-enhanced" style={{ height: `${height}px` }}>
      {data.map((entry, index) => {
        const percentage =
          entry.count !== null && maxValue > 0 ? (entry.count / maxValue) * 100 : null;
        const shouldShowLabel = showLabels && index % Math.max(1, labelEvery) === 0;
        return (
          <div key={entry.key} className="analytics-bar-enhanced">
            <div className="analytics-bar-container">
              <div
                className="analytics-bar-fill-enhanced"
                style={{ height: percentage === null ? '0%' : `${Math.max(percentage, 2)}%` }}
                title={`${entry.label}: ${entry.count === null ? 'No data' : entry.count}`}
                data-no-data={entry.count === null || undefined}
              >
                {showValues && entry.count !== null && entry.count > 0 && (
                  <span className="analytics-bar-value">{entry.count}</span>
                )}
              </div>
            </div>
            {shouldShowLabel ? (
              <span className="analytics-bar-label">{entry.label}</span>
            ) : (
              <span className="analytics-bar-label" aria-hidden="true">
                &nbsp;
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
