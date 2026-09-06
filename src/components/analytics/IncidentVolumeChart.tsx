'use client';

import React, { useState } from 'react';

interface ChartDatum {
  key: string;
  label: string;
  count: number;
}

interface IncidentVolumeChartProps {
  data: ChartDatum[];
  height?: number;
}

export default function IncidentVolumeChart({ data, height = 160 }: IncidentVolumeChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-muted-foreground text-sm"
        style={{ height }}
      >
        No volume data available
      </div>
    );
  }

  const maxValue = Math.max(1, ...data.map(d => d.count));
  const startLabel = data[0]?.label ?? '';
  const endLabel = data[data.length - 1]?.label ?? '';

  // Helper to determine color based on intensity
  const getBarColor = (count: number, max: number, isHovered: boolean) => {
    if (count === 0) return 'rgba(255, 255, 255, 0.03)'; // Very faint for zero

    // Gradient definition is handled in CSS, but we can return opacity/classes
    return isHovered ? 'bg-indigo-400' : 'bg-indigo-500';
  };

  return (
    <div
      className="w-full flex flex-col gap-3 font-sans"
      role="img"
      aria-label="Incident Volume Chart"
    >
      {/* Main Chart Area */}
      <div
        className="relative flex items-end justify-between w-full"
        style={{ height: `${height}px` }}
        onMouseLeave={() => setHoveredIndex(null)}
      >
        {data.map((entry, index) => {
          const percent = (entry.count / maxValue) * 100;
          const isHovered = hoveredIndex === index;
          // Ensure a tiny bit of height for 0 values just for visual continuity, or 0.
          const visualHeight = entry.count === 0 ? 4 : Math.max(4, percent);

          return (
            <div
              key={entry.key}
              className="relative flex-1 h-full flex items-end justify-center group px-[1px]"
              onMouseEnter={() => setHoveredIndex(index)}
            >
              {/* Tooltip (visible on hover) */}
              <div
                className={`absolute bottom-full mb-2 z-10 transition-all duration-200 pointer-events-none transform ${
                  isHovered
                    ? 'opacity-100 translate-y-0 scale-100'
                    : 'opacity-0 translate-y-2 scale-95'
                }`}
              >
                <div className="bg-popover text-popover-foreground text-xs font-semibold px-2 py-1 rounded shadow-lg border border-border whitespace-nowrap">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">
                    {entry.label}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-indigo-400 text-lg leading-none font-bold">
                      {entry.count}
                    </span>
                    <span className="font-medium">Incidents</span>
                  </div>
                </div>
                {/* Little triangle arrow */}
                <div className="w-2 h-2 bg-popover border-r border-b border-border rotate-45 absolute left-1/2 -ml-1 -bottom-1"></div>
              </div>

              {/* The Bar */}
              <div
                className={`w-full rounded-t-[2px] transition-all duration-300 ease-out origin-bottom ${
                  entry.count > 0 ? 'shadow-[0_0_12px_-2px_rgba(99,102,241,0.5)]' : ''
                }`}
                style={{
                  height: `${visualHeight}%`,
                  background:
                    entry.count === 0
                      ? 'rgba(255,255,255,0.05)'
                      : 'linear-gradient(180deg, #a855f7 0%, #6366f1 100%)', // Purple to Indigo
                  opacity: hoveredIndex !== null && !isHovered ? 0.4 : 1, // Focus effect
                  transform: isHovered ? 'scaleY(1.05)' : 'scaleY(1)',
                }}
              />
            </div>
          );
        })}

        {/* Dashed Grid Lines (Visual Decoration) */}
        <div className="absolute inset-0 pointer-events-none z-0 flex flex-col justify-between opacity-10">
          <div className="w-full border-t border-white border-dashed"></div>
          <div className="w-full border-t border-white border-dashed"></div>
          <div className="w-full border-t border-white border-dashed"></div>
        </div>
      </div>

      {/* X-Axis Labels */}
      <div className="flex justify-between text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-widest pt-1 border-t border-white/5">
        <span>{startLabel}</span>
        <span>{endLabel}</span>
      </div>
    </div>
  );
}
