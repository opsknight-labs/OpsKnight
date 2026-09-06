'use client';

import { memo } from 'react';

type GaugeWidgetProps = {
  value: number | null;
  label?: string;
  target?: number;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'auto';
};

/**
 * GaugeWidget - Radial progress gauge for percentage metrics
 *
 * Features:
 * - Semi-circular gauge with needle
 * - Auto-coloring based on value thresholds
 * - Optional target line
 */
const GaugeWidget = memo(function GaugeWidget({
  value,
  label,
  target = 95,
  variant = 'auto',
}: GaugeWidgetProps) {
  const displayValue = value ?? 0;
  const clampedValue = Math.min(100, Math.max(0, displayValue));

  // Calculate needle rotation (-90 to 90 degrees)
  const rotation = (clampedValue / 100) * 180 - 90;

  // Auto-determine color based on thresholds
  const getColor = (): string => {
    if (variant !== 'auto') {
      const colorMap = {
        default: '#6b7280',
        success: '#22c55e',
        warning: '#eab308',
        danger: '#ef4444',
      };
      return colorMap[variant];
    }

    // Auto color based on value
    if (displayValue >= 95) return '#22c55e'; // green
    if (displayValue >= 80) return '#eab308'; // yellow
    return '#ef4444'; // red
  };

  const color = getColor();

  // Calculate the arc length for the progress
  const arcLength = 126; // Approximate length of the semi-circle path
  const progressLength = (clampedValue / 100) * arcLength;

  return (
    <div className="flex flex-col items-center justify-center h-full gap-1">
      <div className="relative w-full max-w-[140px]">
        <svg viewBox="0 0 100 55" className="w-full">
          {/* Background arc */}
          <path
            d="M 10 50 A 40 40 0 0 1 90 50"
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            strokeLinecap="round"
            className="text-muted/30"
          />

          {/* Progress arc */}
          <path
            d="M 10 50 A 40 40 0 0 1 90 50"
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${progressLength} ${arcLength}`}
            style={{
              transition: 'stroke-dasharray 0.5s ease-out',
            }}
          />

          {/* Target marker (if different from 100) */}
          {target < 100 && (
            <circle
              cx={50 + 40 * Math.cos((Math.PI * (180 - (target / 100) * 180)) / 180)}
              cy={50 - 40 * Math.sin((Math.PI * (180 - (target / 100) * 180)) / 180)}
              r="2"
              fill="#374151"
              className="opacity-50"
            />
          )}

          {/* Needle */}
          <g transform={`rotate(${rotation} 50 50)`}>
            <line
              x1="50"
              y1="50"
              x2="50"
              y2="18"
              stroke="#374151"
              strokeWidth="2"
              strokeLinecap="round"
              className="dark:stroke-gray-300"
            />
          </g>

          {/* Center dot */}
          <circle cx="50" cy="50" r="4" fill="#374151" className="dark:fill-gray-300" />
        </svg>
      </div>

      {/* Value */}
      <div className="text-2xl font-bold" style={{ color }}>
        {value !== null ? `${value.toFixed(0)}%` : '--'}
      </div>

      {/* Label */}
      {label && <div className="text-xs text-muted-foreground text-center">{label}</div>}
    </div>
  );
});

export default GaugeWidget;
