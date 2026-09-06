'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';

type SparklineChartProps = {
    data: number[];
    width?: number;
    height?: number;
    color?: string;
    fillColor?: string;
    strokeWidth?: number;
    className?: string;
    showDots?: boolean;
};

/**
 * Minimal sparkline chart using SVG
 * Renders a small trend line for compact display
 */
export default function SparklineChart({
    data,
    width = 80,
    height = 24,
    color = '#3b82f6',
    fillColor,
    strokeWidth = 1.5,
    className,
    showDots = false,
}: SparklineChartProps) {
    const { path, fillPath, points } = useMemo(() => {
        if (!data || data.length < 2) {
            return { path: '', fillPath: '', points: [] };
        }

        const padding = 2;
        const chartWidth = width - padding * 2;
        const chartHeight = height - padding * 2;

        const min = Math.min(...data);
        const max = Math.max(...data);
        const range = max - min || 1;

        const pointsArray = data.map((value, index) => {
            const x = padding + (index / (data.length - 1)) * chartWidth;
            const y = padding + chartHeight - ((value - min) / range) * chartHeight;
            return { x, y, value };
        });

        const linePath = pointsArray
            .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
            .join(' ');

        // Create fill path (closed shape)
        const filledPath = fillColor
            ? `${linePath} L ${pointsArray[pointsArray.length - 1].x} ${height - padding} L ${padding} ${height - padding} Z`
            : '';

        return { path: linePath, fillPath: filledPath, points: pointsArray };
    }, [data, width, height]);

    if (!data || data.length < 2) {
        return (
            <div
                className={cn('flex items-center justify-center text-muted-foreground text-xs', className)}
                style={{ width, height }}
            >
                —
            </div>
        );
    }

    return (
        <svg
            width={width}
            height={height}
            className={cn('overflow-visible', className)}
            aria-label="Trend chart"
        >
            {/* Fill area */}
            {fillColor && (
                <path d={fillPath} fill={fillColor} opacity={0.2} />
            )}

            {/* Line */}
            <path
                d={path}
                fill="none"
                stroke={color}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
            />

            {/* Dots */}
            {showDots &&
                points.map((point, index) => (
                    <circle
                        key={index}
                        cx={point.x}
                        cy={point.y}
                        r={index === points.length - 1 ? 2.5 : 1.5}
                        fill={index === points.length - 1 ? color : 'white'}
                        stroke={color}
                        strokeWidth={1}
                    />
                ))}

            {/* End dot (always show last point) */}
            {!showDots && points.length > 0 && (
                <circle
                    cx={points[points.length - 1].x}
                    cy={points[points.length - 1].y}
                    r={2}
                    fill={color}
                />
            )}
        </svg>
    );
}
