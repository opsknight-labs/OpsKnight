'use client';

import { ReactNode, useRef, useState, useMemo, useCallback } from 'react';

interface VirtualListProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  itemHeight: number | ((index: number) => number);
  containerHeight: number;
  overscan?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Virtual scrolling list component for rendering large lists efficiently
 * Only renders visible items plus a buffer (overscan) for smooth scrolling
 *
 * @example
 * <VirtualList
 *   items={users}
 *   renderItem={(user) => <UserCard user={user} />}
 *   itemHeight={80}
 *   containerHeight={600}
 *   overscan={5}
 * />
 */
export default function VirtualList<T>({
  items,
  renderItem,
  itemHeight,
  containerHeight,
  overscan = 5,
  className = '',
  style,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  // Calculate item heights
  const itemHeights = useMemo(() => {
    if (typeof itemHeight === 'number') {
      return items.map(() => itemHeight);
    }
    return items.map((_, index) => itemHeight(index));
  }, [items, itemHeight]);

  // Calculate total height
  const totalHeight = useMemo(() => {
    return itemHeights.reduce((sum, height) => sum + height, 0);
  }, [itemHeights]);

  // Calculate visible range
  const { startIndex, endIndex, offsetY } = useMemo(() => {
    let currentTop = 0;
    let start = 0;
    let end = 0;
    let offset = 0;

    // Find start index
    for (let i = 0; i < items.length; i++) {
      const height = itemHeights[i];
      if (currentTop + height > scrollTop) {
        start = Math.max(0, i - overscan);
        offset = currentTop;
        break;
      }
      currentTop += height;
    }

    // Find end index
    currentTop = offset;
    const viewportBottom = scrollTop + containerHeight;
    for (let i = start; i < items.length; i++) {
      const height = itemHeights[i];
      if (currentTop > viewportBottom) {
        end = Math.min(items.length, i + overscan);
        break;
      }
      currentTop += height;
      end = i + 1;
    }
    end = Math.min(items.length, end + overscan);

    return { startIndex: start, endIndex: end, offsetY: offset };
  }, [scrollTop, containerHeight, itemHeights, items.length, overscan]);

  // Memoize scroll handler to prevent unnecessary re-renders
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  // Visible items
  const visibleItems = useMemo(() => {
    return items.slice(startIndex, endIndex);
  }, [items, startIndex, endIndex]);

  if (items.length === 0) {
    return (
      <div
        ref={containerRef}
        className={className}
        style={{
          height: containerHeight,
          overflow: 'auto',
          ...style,
        }}
      >
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          No items to display
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={className}
      onScroll={handleScroll}
      style={{
        height: containerHeight,
        overflow: 'auto',
        position: 'relative',
        ...style,
      }}
    >
      {/* Spacer for items before visible range */}
      {offsetY > 0 && (
        <div
          style={{
            height: offsetY,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Visible items */}
      <div>
        {visibleItems.map((item, index) => {
          const actualIndex = startIndex + index;
          return (
            <div key={actualIndex} style={{ height: itemHeights[actualIndex] }}>
              {renderItem(item, actualIndex)}
            </div>
          );
        })}
      </div>

      {/* Spacer for items after visible range */}
      {endIndex < items.length && (
        <div
          style={{
            height:
              totalHeight -
              offsetY -
              visibleItems.reduce((sum, _, i) => sum + itemHeights[startIndex + i], 0),
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}
