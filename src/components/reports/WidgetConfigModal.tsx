'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/shadcn/dialog';
import { Button } from '@/components/ui/shadcn/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { Settings2, RotateCcw, BarChart3, LineChart, PieChart } from 'lucide-react';
import { getWidgetById } from '@/lib/reports/widget-registry';

export type ConfigurableWidget = {
  id: string;
  widgetType: string;
  metricKey: string;
  widgetDefinitionId?: string;
  title?: string | null;
  position: { x: number; y: number; w: number; h: number };
  config: Record<string, unknown>;
};

interface WidgetConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  widget: ConfigurableWidget | null;
  onSave: (updatedWidget: ConfigurableWidget) => void;
}

interface WidgetConfigFormProps {
  widget: ConfigurableWidget;
  onClose: () => void;
  onSave: (updatedWidget: ConfigurableWidget) => void;
}

function WidgetConfigForm({ widget, onClose, onSave }: WidgetConfigFormProps) {
  const widgetDef = widget.widgetDefinitionId ? getWidgetById(widget.widgetDefinitionId) : null;
  const defaultTitle = widgetDef?.name || widget.title || 'Widget';

  const [title, setTitle] = useState(widget.title ?? defaultTitle);
  const [width, setWidth] = useState(widget.position.w);
  const [height, setHeight] = useState(widget.position.h);
  const [chartType, setChartType] = useState<string>(
    typeof widget.config?.chartType === 'string'
      ? (widget.config.chartType as string)
      : widget.widgetType === 'chart'
        ? 'line'
        : ''
  );
  const [targetSla, setTargetSla] = useState<string>(
    typeof widget.config?.targetSla === 'number'
      ? String(widget.config.targetSla)
      : ''
  );

  const handleApply = () => {
    const updatedConfig: Record<string, unknown> = {
      ...widget.config,
    };

    if (widget.widgetType === 'chart' && chartType) {
      updatedConfig.chartType = chartType;
    }

    if (targetSla.trim()) {
      const num = parseFloat(targetSla);
      if (!Number.isNaN(num)) {
        updatedConfig.targetSla = num;
      }
    } else {
      delete updatedConfig.targetSla;
    }

    const updatedWidget: ConfigurableWidget = {
      ...widget,
      title: title.trim() || defaultTitle,
      position: {
        ...widget.position,
        w: width,
        h: height,
      },
      config: updatedConfig,
    };

    onSave(updatedWidget);
    onClose();
  };

  const isChart = widget.widgetType === 'chart';
  const isGauge =
    widget.widgetType === 'gauge' ||
    widget.metricKey.toLowerCase().includes('compliance') ||
    widget.metricKey.toLowerCase().includes('rate');

  return (
    <>
      <div className="space-y-4 py-2">
        {/* Custom Widget Title */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Widget Title
            </label>
            {title !== defaultTitle && (
              <button
                type="button"
                onClick={() => setTitle(defaultTitle)}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <RotateCcw className="h-3 w-3" />
                Reset to default
              </button>
            )}
          </div>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="w-full bg-background border border-input rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
            placeholder={defaultTitle}
          />
        </div>

        {/* Grid Dimensions */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Column Width
            </label>
            <Select value={String(width)} onValueChange={v => setWidth(Number(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 Column (25%)</SelectItem>
                <SelectItem value="2">2 Columns (50%)</SelectItem>
                <SelectItem value="3">3 Columns (75%)</SelectItem>
                <SelectItem value="4">4 Columns (Full Width)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Row Height
            </label>
            <Select value={String(height)} onValueChange={v => setHeight(Number(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 Row (Compact)</SelectItem>
                <SelectItem value="2">2 Rows (Standard)</SelectItem>
                <SelectItem value="3">3 Rows (Expanded)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Chart Visualization Switcher (if applicable) */}
        {isChart && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Chart Visualization
            </label>
            <Select value={chartType} onValueChange={setChartType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="line">
                  <div className="flex items-center gap-2">
                    <LineChart className="h-4 w-4 text-primary" />
                    <span>Line Chart (Continuous Trend)</span>
                  </div>
                </SelectItem>
                <SelectItem value="bar">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-emerald-500" />
                    <span>Bar Chart (Discrete Buckets)</span>
                  </div>
                </SelectItem>
                <SelectItem value="pie">
                  <div className="flex items-center gap-2">
                    <PieChart className="h-4 w-4 text-amber-500" />
                    <span>Pie / Proportional Mix</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Target SLA Threshold (for gauges & rates) */}
        {isGauge && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Target SLA Goal (%)
            </label>
            <input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={targetSla}
              onChange={e => setTargetSla(e.target.value)}
              placeholder="e.g. 99.0"
              className="w-full bg-background border border-input rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
            />
            <p className="text-[11px] text-muted-foreground">
              Optional threshold to compare current performance against organizational SLA goals.
            </p>
          </div>
        )}
      </div>

      <DialogFooter className="gap-2 sm:justify-end">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={handleApply}>
          Apply Changes
        </Button>
      </DialogFooter>
    </>
  );
}

export default function WidgetConfigModal({
  isOpen,
  onClose,
  widget,
  onSave,
}: WidgetConfigModalProps) {
  if (!widget) return null;

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Settings2 className="h-5 w-5 text-primary" />
            <span>Configure Widget</span>
          </DialogTitle>
          <DialogDescription>
            Customize title, dimensions, and display parameters for this widget.
          </DialogDescription>
        </DialogHeader>

        <WidgetConfigForm key={widget.id} widget={widget} onClose={onClose} onSave={onSave} />
      </DialogContent>
    </Dialog>
  );
}
