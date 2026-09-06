interface BarChartData {
  key: string;
  label: string;
  count: number;
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
        const percentage = maxValue > 0 ? (entry.count / maxValue) * 100 : 0;
        const shouldShowLabel = showLabels && index % Math.max(1, labelEvery) === 0;
        return (
          <div key={entry.key} className="analytics-bar-enhanced">
            <div className="analytics-bar-container">
              <div
                className="analytics-bar-fill-enhanced"
                style={{ height: `${Math.max(percentage, 2)}%` }}
                title={`${entry.label}: ${entry.count}`}
              >
                {showValues && entry.count > 0 && (
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
