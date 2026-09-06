interface GaugeChartProps {
    value: number;
    max?: number;
    label?: string;
    thresholds?: {
        good: number;
        warning: number;
    };
    size?: number;
}

export default function GaugeChart({ 
    value, 
    max = 100, 
    label, 
    thresholds = { good: 80, warning: 60 },
    size = 120 
}: GaugeChartProps) {
    const percentage = Math.min(100, Math.max(0, (value / max) * 100));
    const radius = size / 2 - 10;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percentage / 100) * circumference;

    let color = '#ef4444'; // danger
    if (percentage >= thresholds.good) {
        color = '#22c55e'; // success
    } else if (percentage >= thresholds.warning) {
        color = '#f59e0b'; // warning
    }

    return (
        <div className="analytics-gauge-container">
            <svg width={size} height={size / 2 + 20} className="analytics-gauge">
                {/* Background arc */}
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke="#e5e7eb"
                    strokeWidth="8"
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference / 2}
                    transform={`rotate(-90 ${size / 2} ${size / 2})`}
                />
                {/* Value arc */}
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke={color}
                    strokeWidth="8"
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference / 2 + offset}
                    transform={`rotate(-90 ${size / 2} ${size / 2})`}
                    className="analytics-gauge-arc"
                />
                {/* Value text */}
                <text
                    x={size / 2}
                    y={size / 2 + 5}
                    textAnchor="middle"
                    className="analytics-gauge-value"
                    fill={color}
                >
                    {percentage.toFixed(0)}%
                </text>
            </svg>
            {label && (
                <div className="analytics-gauge-label">{label}</div>
            )}
        </div>
    );
}

