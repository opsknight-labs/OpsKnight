'use client';

interface SparklineChartProps {
    data: number[];
    width?: number;
    height?: number;
    color?: string;
    fillOpacity?: number;
    showArea?: boolean;
}

export default function SparklineChart({
    data,
    width = 100,
    height = 32,
    color = '#8b5cf6',
    fillOpacity = 0.2,
    showArea = true
}: SparklineChartProps) {
    if (!data || data.length === 0) {
        return <div style={{ width, height }} />;
    }

    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    const padding = 2;

    const points = data.map((value, index) => {
        const x = padding + (index / (data.length - 1)) * (width - padding * 2);
        const y = height - padding - ((value - min) / range) * (height - padding * 2);
        return { x, y };
    });

    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    const areaPath = `${linePath} L ${points[points.length - 1].x} ${height} L ${points[0].x} ${height} Z`;

    const trend = data[data.length - 1] > data[0] ? 'up' : data[data.length - 1] < data[0] ? 'down' : 'flat';
    const trendColor = trend === 'up' ? '#ef4444' : trend === 'down' ? '#22c55e' : color;

    return (
        <svg width={width} height={height} className="sparkline-chart">
            <defs>
                <linearGradient id={`sparkline-gradient-${color.replace('#', '')}`} x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor={trendColor} stopOpacity={fillOpacity} />
                    <stop offset="100%" stopColor={trendColor} stopOpacity={0} />
                </linearGradient>
            </defs>
            {showArea && (
                <path
                    d={areaPath}
                    fill={`url(#sparkline-gradient-${color.replace('#', '')})`}
                />
            )}
            <path
                d={linePath}
                fill="none"
                stroke={trendColor}
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            {/* End dot */}
            <circle
                cx={points[points.length - 1].x}
                cy={points[points.length - 1].y}
                r={2.5}
                fill={trendColor}
            />
        </svg>
    );
}
