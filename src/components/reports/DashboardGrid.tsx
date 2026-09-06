'use client';

import { memo, useMemo, useState } from 'react';
import { Plus, GripVertical } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import WidgetWrapper from './WidgetWrapper';
import {
  MetricWidget,
  GaugeWidget,
  TableWidget,
  InsightsWidget,
  ChartWidget,
  getMetricData,
  getPreviousPeriodValue,
} from './widgets';
import type { SerializedSLAMetrics } from '@/lib/sla';
import { getWidgetById } from '@/lib/reports/widget-registry';

type Widget = {
  id: string;
  widgetType: string;
  metricKey: string;
  title?: string | null;
  position: { x: number; y: number; w: number; h: number };
  config: Record<string, any>;
};

type DashboardGridProps = {
  widgets: Widget[];
  metrics: SerializedSLAMetrics | null;
  isEditing?: boolean;
  isLoading?: boolean;
  columns?: number;
  rowHeight?: number;
  gap?: number;
  onRemoveWidget?: (widgetId: string) => void;
  onConfigureWidget?: (widgetId: string) => void;
  onUpdateLayout?: (widgets: Widget[]) => void;
  onAddWidget?: () => void;
};

/**
 * DashboardGrid - Main grid layout for dashboard widgets
 *
 * Uses @dnd-kit for smooth drag-and-drop with animations.
 */
const DashboardGrid = memo(function DashboardGrid({
  widgets,
  metrics,
  isEditing = false,
  isLoading = false,
  columns = 4,
  rowHeight = 150,
  gap = 16,
  onRemoveWidget,
  onConfigureWidget,
  onUpdateLayout,
  onAddWidget,
}: DashboardGridProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  // Sort widgets by position for consistent rendering
  const sortedWidgets = useMemo(() => {
    return [...widgets].sort((a, b) => {
      if (a.position.y !== b.position.y) return a.position.y - b.position.y;
      return a.position.x - b.position.x;
    });
  }, [widgets]);

  // Configure sensors for drag detection
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement before drag starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Get the active widget for the overlay
  const activeWidget = useMemo(() => {
    return sortedWidgets.find(w => w.id === activeId);
  }, [activeId, sortedWidgets]);

  // Handle drag start
  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  // Handle drag end
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over || active.id === over.id || !onUpdateLayout) {
      return;
    }

    const oldIndex = sortedWidgets.findIndex(w => w.id === active.id);
    const newIndex = sortedWidgets.findIndex(w => w.id === over.id);

    if (oldIndex !== -1 && newIndex !== -1) {
      const newOrder = arrayMove(sortedWidgets, oldIndex, newIndex);
      const recalculated = recalculatePositions(newOrder, columns);
      onUpdateLayout(recalculated);
    }
  };

  if (widgets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
        <Plus className="h-12 w-12 mb-4 opacity-30" />
        <p className="text-lg font-medium mb-2">No widgets yet</p>
        <p className="text-sm mb-4">Add widgets to start building your dashboard</p>
        {onAddWidget && (
          <button
            onClick={onAddWidget}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Widget
          </button>
        )}
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={sortedWidgets.map(w => w.id)} strategy={rectSortingStrategy}>
        <div
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${columns}, 1fr)`,
            gridAutoRows: `${rowHeight}px`,
            gap: `${gap}px`,
          }}
        >
          {sortedWidgets.map(widget => (
            <SortableWidgetItem
              key={widget.id}
              widget={widget}
              metrics={metrics}
              isEditing={isEditing}
              isLoading={isLoading}
              isDragging={activeId === widget.id}
              onRemove={onRemoveWidget ? () => onRemoveWidget(widget.id) : undefined}
              onConfigure={onConfigureWidget ? () => onConfigureWidget(widget.id) : undefined}
            />
          ))}
        </div>
      </SortableContext>

      {/* Drag Overlay - shows the widget being dragged */}
      <DragOverlay adjustScale={false}>
        {activeWidget && (
          <div
            className="shadow-2xl opacity-90 ring-2 ring-primary rounded-lg"
            style={{
              width: `calc((100vw - 64px) / ${columns} * ${activeWidget.position.w} - ${gap}px)`,
              height: `${rowHeight * activeWidget.position.h + gap * (activeWidget.position.h - 1)}px`,
            }}
          >
            <WidgetContent
              widget={activeWidget}
              metrics={metrics}
              isEditing={false}
              isLoading={false}
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
});

/**
 * SortableWidgetItem - Individual sortable widget
 */
const SortableWidgetItem = memo(function SortableWidgetItem({
  widget,
  metrics,
  isEditing,
  isLoading,
  isDragging,
  onRemove,
  onConfigure,
}: {
  widget: Widget;
  metrics: SerializedSLAMetrics | null;
  isEditing: boolean;
  isLoading: boolean;
  isDragging: boolean;
  onRemove?: () => void;
  onConfigure?: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({
    id: widget.id,
    disabled: !isEditing,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    gridColumn: `${widget.position.x + 1} / span ${widget.position.w}`,
    gridRow: `${widget.position.y + 1} / span ${widget.position.h}`,
    opacity: isSortableDragging ? 0.3 : 1,
    zIndex: isSortableDragging ? 1000 : 'auto',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative transition-opacity duration-200 ${
        isEditing ? 'group/widget' : ''
      } ${isDragging ? 'z-50' : ''}`}
    >
      {/* Drag handle overlay for edit mode */}
      {isEditing && (
        <div
          {...attributes}
          {...listeners}
          className="absolute inset-0 z-10 cursor-grab active:cursor-grabbing"
          style={{ touchAction: 'none' }}
        >
          {/* Visible drag indicator */}
          <div className="absolute top-1 left-1/2 -translate-x-1/2 opacity-0 group-hover/widget:opacity-100 transition-opacity z-20">
            <div className="flex items-center gap-1 px-2 py-1 bg-primary text-primary-foreground text-xs rounded-full shadow-lg">
              <GripVertical className="h-3 w-3" />
              <span>Drag</span>
            </div>
          </div>
        </div>
      )}

      <WidgetContent
        widget={widget}
        metrics={metrics}
        isEditing={isEditing}
        isLoading={isLoading}
        onRemove={onRemove}
        onConfigure={onConfigure}
      />
    </div>
  );
});

/**
 * Recalculate widget positions based on order (flow layout)
 */
function recalculatePositions(widgets: Widget[], columns: number): Widget[] {
  let currentX = 0;
  let currentY = 0;
  let rowHeight = 1;

  return widgets.map(widget => {
    const w = widget.position.w;
    const h = widget.position.h;

    // If widget doesn't fit in current row, move to next row
    if (currentX + w > columns) {
      currentX = 0;
      currentY += rowHeight;
      rowHeight = 1;
    }

    const newPosition = {
      x: currentX,
      y: currentY,
      w,
      h,
    };

    // Update row height if this widget is taller
    rowHeight = Math.max(rowHeight, h);

    // Move x position for next widget
    currentX += w;

    return {
      ...widget,
      position: newPosition,
    };
  });
}

/**
 * WidgetContent - Renders the appropriate widget component based on type
 */
const WidgetContent = memo(function WidgetContent({
  widget,
  metrics,
  isEditing,
  isLoading,
  onRemove,
  onConfigure,
}: {
  widget: Widget;
  metrics: SerializedSLAMetrics | null;
  isEditing: boolean;
  isLoading: boolean;
  onRemove?: () => void;
  onConfigure?: () => void;
}) {
  // Get widget definition for default title
  const definition = getWidgetById(widget.metricKey.replace('Widget', '').toLowerCase());
  const title = widget.title || definition?.name || widget.metricKey;

  // Get metric data
  const data = metrics ? getMetricData(metrics, widget.metricKey) : null;
  const previousValue = metrics ? getPreviousPeriodValue(metrics, widget.metricKey) : null;

  // Render based on widget type
  const renderContent = () => {
    if (!metrics) {
      return null;
    }

    switch (widget.widgetType) {
      case 'metric':
        return (
          <MetricWidget
            value={typeof data === 'number' ? data : null}
            metricKey={widget.metricKey}
            previousValue={previousValue}
          />
        );

      case 'gauge':
        return (
          <GaugeWidget
            value={typeof data === 'number' ? data : null}
            label={widget.config?.label}
          />
        );

      case 'table':
        return (
          <TableWidget
            data={Array.isArray(data) ? data : []}
            metricKey={widget.metricKey}
            maxRows={widget.config?.maxRows}
          />
        );

      case 'insights':
        return (
          <InsightsWidget
            insights={Array.isArray(data) ? data : []}
            maxItems={widget.config?.maxItems}
          />
        );

      case 'chart':
        return (
          <ChartWidget
            metricKey={widget.metricKey}
            metrics={metrics}
            config={{
              chartType: widget.config?.chartType || 'line',
              color: widget.config?.color,
              height: widget.config?.height || 160,
              showLegend: widget.config?.showLegend,
              showTrend: widget.config?.showTrend,
            }}
          />
        );

      default:
        return (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Unknown widget type: {widget.widgetType}
          </div>
        );
    }
  };

  return (
    <WidgetWrapper
      title={title}
      isEditing={isEditing}
      isLoading={isLoading}
      onRemove={onRemove}
      onConfigure={onConfigure}
    >
      {renderContent()}
    </WidgetWrapper>
  );
});

export default DashboardGrid;
