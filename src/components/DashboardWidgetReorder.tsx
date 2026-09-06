'use client';

import { useState, useEffect, useCallback, memo, useRef } from 'react';

type WidgetReorderProps = {
  children: React.ReactNode;
  widgetId: string;
  defaultOrder?: number;
};

const STORAGE_KEY = 'dashboard-widget-order';

/**
 * Safely reads widget orders from localStorage
 */
function getStoredOrders(): Record<string, number> {
  if (typeof window === 'undefined') return {};

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return {};
    const parsed = JSON.parse(saved);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Safely writes widget orders to localStorage
 */
function setStoredOrders(orders: Record<string, number>): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
  } catch {
    // Silently fail if storage is unavailable
  }
}

/**
 * DashboardWidgetReorder
 * Enables drag-and-drop reordering of dashboard widgets
 * Persists order to localStorage
 */
const DashboardWidgetReorder = memo(function DashboardWidgetReorder({
  children,
  widgetId,
  defaultOrder = 0,
}: WidgetReorderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const elementRef = useRef<HTMLDivElement>(null);

  // Load saved order on mount (for potential future use)
  useEffect(() => {
    // Order is stored but not actively used for positioning in this component
    // The parent component should read from localStorage to sort widgets
    getStoredOrders();
  }, [widgetId]);

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      setIsDragging(true);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', widgetId);
      e.dataTransfer.setData('application/widget-id', widgetId);

      // Use setTimeout to avoid flickering during drag start
      setTimeout(() => {
        if (elementRef.current) {
          elementRef.current.style.opacity = '0.5';
        }
      }, 0);
    },
    [widgetId]
  );

  const handleDragEnd = useCallback((_e: React.DragEvent<HTMLDivElement>) => {
    setIsDragging(false);
    if (elementRef.current) {
      elementRef.current.style.opacity = '1';
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDropTarget(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    // Only set to false if we're leaving the element (not entering a child)
    if (!elementRef.current?.contains(e.relatedTarget as Node)) {
      setIsDropTarget(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDropTarget(false);

      const draggedWidgetId =
        e.dataTransfer.getData('application/widget-id') || e.dataTransfer.getData('text/plain');

      if (!draggedWidgetId || draggedWidgetId === widgetId) {
        return;
      }

      try {
        // Read current orders
        const orders = getStoredOrders();

        // Get current orders (using defaults if not set)
        const draggedOrder = orders[draggedWidgetId] ?? defaultOrder;
        const currentOrder = orders[widgetId] ?? defaultOrder;

        // Swap orders
        orders[draggedWidgetId] = currentOrder;
        orders[widgetId] = draggedOrder;

        // Save to localStorage
        setStoredOrders(orders);

        // Dispatch custom event to notify parent components
        window.dispatchEvent(
          new CustomEvent('widget-reordered', {
            detail: {
              from: draggedWidgetId,
              to: widgetId,
              orders,
            },
          })
        );
      } catch {
        // Silently fail on error
      }
    },
    [widgetId, defaultOrder]
  );

  return (
    <div
      ref={elementRef}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        cursor: isDragging ? 'grabbing' : 'grab',
        opacity: isDragging ? 0.5 : 1,
        position: 'relative',
        outline: isDropTarget ? '2px dashed var(--primary-color)' : 'none',
        outlineOffset: '2px',
        transition: 'outline 0.2s ease',
      }}
      role="listitem"
      aria-grabbed={isDragging}
      aria-label={`Draggable widget: ${widgetId}`}
    >
      {/* Drag handle indicator */}
      <div
        style={{
          position: 'absolute',
          top: '0.5rem',
          right: '0.5rem',
          background: 'rgba(0, 0, 0, 0.05)',
          borderRadius: '4px',
          padding: '0.25rem 0.5rem',
          fontSize: '0.7rem',
          color: 'var(--text-muted)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.25rem',
          zIndex: 10,
          pointerEvents: 'none',
          userSelect: 'none',
        }}
        aria-hidden="true"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="currentColor"
          style={{ opacity: 0.5 }}
        >
          <circle cx="9" cy="6" r="2" />
          <circle cx="15" cy="6" r="2" />
          <circle cx="9" cy="12" r="2" />
          <circle cx="15" cy="12" r="2" />
          <circle cx="9" cy="18" r="2" />
          <circle cx="15" cy="18" r="2" />
        </svg>
        <span>Drag</span>
      </div>
      {children}
    </div>
  );
});

export default DashboardWidgetReorder;
