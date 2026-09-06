'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';

interface HeatmapCalendarProps {
  data: { date: string; count: number }[];
  startDate?: Date;
  days?: number;
  cellSize?: number;
  gap?: number;
  fitWidth?: boolean;
}

// Improved color scheme - uses semantic colors for incidents
// 0 incidents = muted/neutral, more incidents = warmer/more urgent colors
const getIntensityColor = (count: number, maxCount: number): string => {
  if (count < 0) return 'transparent';
  if (count === 0) return '#e2e8f0'; // slate-200 - neutral for no incidents

  const intensity = maxCount > 0 ? count / maxCount : 0;
  if (intensity <= 0.25) return '#86efac'; // green-300 - low activity
  if (intensity <= 0.5) return '#fde047'; // yellow-300 - moderate activity
  if (intensity <= 0.75) return '#fdba74'; // orange-300 - elevated activity
  return '#fca5a5'; // red-300 - high activity
};

const getDayLabel = (dayIndex: number): string => {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[dayIndex];
};

const monthNames = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export default function HeatmapCalendar({
  data,
  startDate,
  days = 90,
  cellSize = 12,
  gap = 3,
  fitWidth = false,
}: HeatmapCalendarProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);

  // Memoize data map and max count
  const { dataMap, maxCount } = useMemo(() => {
    const map = new Map(data.map(d => [d.date, d.count]));
    const max = Math.max(1, ...data.map(d => d.count));
    return { dataMap: map, maxCount: max };
  }, [data]);

  // Memoize date calculations
  const { normalizedStart, rangeEnd, startOfWeek, endOfWeek, weeks } = useMemo(() => {
    const today = new Date();
    const rangeStart = startDate ? new Date(startDate) : new Date(today);
    const normalized = new Date(
      Date.UTC(rangeStart.getUTCFullYear(), rangeStart.getUTCMonth(), rangeStart.getUTCDate())
    );
    const end = new Date(normalized);
    end.setUTCDate(end.getUTCDate() + days - 1);

    const weekStart = new Date(normalized);
    weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
    const weekEnd = new Date(end);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + (6 - weekEnd.getUTCDay()));

    const totalDays = Math.round((weekEnd.getTime() - weekStart.getTime()) / 86400000) + 1;
    const weeksCount = Math.ceil(totalDays / 7);

    return {
      normalizedStart: normalized,
      rangeEnd: end,
      startOfWeek: weekStart,
      endOfWeek: weekEnd,
      weeks: weeksCount,
    };
  }, [startDate, days]);

  // ResizeObserver for responsive sizing
  const handleResize = useCallback(() => {
    if (containerRef.current) {
      setContainerWidth(containerRef.current.getBoundingClientRect().width);
    }
  }, []);

  useEffect(() => {
    if (!fitWidth || !containerRef.current) return undefined;

    handleResize();
    const observer = new ResizeObserver(handleResize);
    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, [fitWidth, handleResize]);

  // Improved responsive scaling - cells grow to fill available space
  const leftGutter = containerWidth && containerWidth < 400 ? 20 : 32;
  const topPadding = 20;

  const { effectiveCellSize, effectiveGap, showDayLabels } = useMemo(() => {
    if (!fitWidth || !containerWidth) {
      return { effectiveCellSize: cellSize, effectiveGap: gap, showDayLabels: true };
    }

    const rightPadding = 8;
    const availableWidth = Math.max(0, containerWidth - leftGutter - rightPadding);

    // Calculate optimal cell size to fill the available width
    // Formula: availableWidth = weeks * cellSize + (weeks - 1) * gap
    // Assuming gap is roughly cellSize / 4
    // availableWidth = weeks * cellSize + (weeks - 1) * (cellSize / 4)
    // availableWidth = cellSize * (weeks + (weeks - 1) / 4)
    // cellSize = availableWidth / (weeks + (weeks - 1) / 4)

    const gapRatio = 0.25; // gap is 25% of cell size
    const effectiveWeeks = weeks + (weeks - 1) * gapRatio;
    const optimalCellSize = Math.floor(availableWidth / effectiveWeeks);

    // Set min/max based on screen size for readability
    let minCell: number;
    let maxCell: number;
    let showLabels = true;

    if (containerWidth < 320) {
      minCell = 6;
      maxCell = 10;
      showLabels = false;
    } else if (containerWidth < 480) {
      minCell = 8;
      maxCell = 12;
      showLabels = false;
    } else if (containerWidth < 768) {
      minCell = 10;
      maxCell = 16;
    } else if (containerWidth < 1024) {
      minCell = 12;
      maxCell = 20;
    } else if (containerWidth < 1440) {
      minCell = 14;
      maxCell = 24;
    } else {
      // Large screens - allow bigger cells
      minCell = 16;
      maxCell = 32;
    }

    const scaledCell = Math.max(minCell, Math.min(maxCell, optimalCellSize));
    const scaledGap = Math.max(2, Math.round(scaledCell * gapRatio));

    return {
      effectiveCellSize: scaledCell,
      effectiveGap: scaledGap,
      showDayLabels: showLabels,
    };
  }, [cellSize, containerWidth, fitWidth, gap, weeks, leftGutter]);

  // Memoize cells and month labels calculation
  const { cells, monthLabels } = useMemo(() => {
    const cellsArray: { date: Date; count: number; x: number; y: number; dateKey: string }[] = [];
    const labelsArray: { label: string; x: number }[] = [];
    let firstLabelAdded = false;

    for (let weekIndex = 0; weekIndex < weeks; weekIndex++) {
      const weekStart = new Date(startOfWeek);
      weekStart.setUTCDate(weekStart.getUTCDate() + weekIndex * 7);
      let hasMonthStart = false;

      for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
        const date = new Date(weekStart);
        date.setUTCDate(weekStart.getUTCDate() + dayOfWeek);

        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        const dateKey = `${year}-${month}-${day}`;
        const inRange = date >= normalizedStart && date <= rangeEnd;
        const count = inRange ? dataMap.get(dateKey) || 0 : -1;
        const x = weekIndex * (effectiveCellSize + effectiveGap);
        const y = dayOfWeek * (effectiveCellSize + effectiveGap) + topPadding;

        if (inRange && date.getUTCDate() === 1) {
          hasMonthStart = true;
        }

        cellsArray.push({ date, count, x, y, dateKey });
      }

      if (hasMonthStart) {
        labelsArray.push({
          label: monthNames[weekStart.getUTCMonth()],
          x: weekIndex * (effectiveCellSize + effectiveGap),
        });
        firstLabelAdded = true;
      } else if (!firstLabelAdded && weekIndex === 0) {
        labelsArray.push({
          label: monthNames[normalizedStart.getUTCMonth()],
          x: weekIndex * (effectiveCellSize + effectiveGap),
        });
        firstLabelAdded = true;
      }
    }

    return { cells: cellsArray, monthLabels: labelsArray };
  }, [weeks, startOfWeek, normalizedStart, rangeEnd, dataMap, effectiveCellSize, effectiveGap]);

  const width = weeks * effectiveCellSize + Math.max(0, weeks - 1) * effectiveGap + leftGutter;
  const height = 7 * effectiveCellSize + 6 * effectiveGap + topPadding + 4;

  // Responsive font sizes
  const monthFontSize = containerWidth && containerWidth < 480 ? 9 : 10;
  const dayFontSize = containerWidth && containerWidth < 480 ? 8 : 10;

  return (
    <div
      ref={containerRef}
      className="heatmap-calendar-container"
      style={{
        width: '100%',
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <svg
        width={width}
        height={height}
        style={{ overflow: 'visible', marginLeft: leftGutter, display: 'block' }}
        role="img"
        aria-label="Incident activity heatmap calendar"
      >
        {/* Month labels */}
        {monthLabels.map((label, index) => (
          <text
            key={`month-${label.label}-${index}`}
            x={label.x}
            y={12}
            fill="#64748b"
            fontSize={monthFontSize}
            fontWeight={500}
            textAnchor="start"
            style={{ userSelect: 'none' }}
          >
            {label.label}
          </text>
        ))}

        {/* Day labels - only show on larger screens */}
        {showDayLabels &&
          [1, 3, 5].map(dayIndex => (
            <text
              key={`day-${dayIndex}`}
              x={-6}
              y={
                dayIndex * (effectiveCellSize + effectiveGap) + effectiveCellSize / 1.5 + topPadding
              }
              fill="#94a3b8"
              fontSize={dayFontSize}
              textAnchor="end"
              style={{ userSelect: 'none' }}
            >
              {getDayLabel(dayIndex).substring(0, 1)}
            </text>
          ))}

        {/* Cells */}
        {cells.map((cell, i) => (
          <rect
            key={`cell-${cell.dateKey}-${i}`}
            x={cell.x}
            y={cell.y}
            width={effectiveCellSize}
            height={effectiveCellSize}
            rx={Math.min(3, effectiveCellSize / 4)}
            fill={getIntensityColor(cell.count, maxCount)}
            className="heatmap-cell"
            style={{
              transition: 'fill 0.15s ease',
              cursor: cell.count >= 0 ? 'pointer' : 'default',
            }}
          >
            {cell.count >= 0 && (
              <title>{`${cell.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}: ${cell.count} incident${cell.count !== 1 ? 's' : ''}`}</title>
            )}
          </rect>
        ))}
      </svg>

      {/* Legend */}
      <div
        className="heatmap-legend"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: '6px',
          marginTop: '8px',
          paddingRight: '4px',
          fontSize: containerWidth && containerWidth < 480 ? '10px' : '11px',
          color: '#64748b',
        }}
      >
        <span>Less</span>
        <div style={{ display: 'flex', gap: '2px' }}>
          {['#e2e8f0', '#86efac', '#fde047', '#fdba74', '#fca5a5'].map((color, i) => (
            <div
              key={i}
              style={{
                width: containerWidth && containerWidth < 480 ? '10px' : '12px',
                height: containerWidth && containerWidth < 480 ? '10px' : '12px',
                backgroundColor: color,
                borderRadius: '2px',
              }}
            />
          ))}
        </div>
        <span>More</span>
      </div>
    </div>
  );
}
