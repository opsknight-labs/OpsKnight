'use client';

import { useState, useMemo, memo } from 'react';
import {
  X,
  Search,
  Plus,
  BarChart2,
  Gauge,
  Table2,
  Lightbulb,
  TrendingUp,
  Activity,
  AlertTriangle,
  Clock,
  CheckCircle,
  Users,
  Server,
  Shield,
  Sparkles,
} from 'lucide-react';
import {
  getAllWidgets,
  getWidgetsByCategory,
  type WidgetDefinition,
  type WidgetCategory,
} from '@/lib/reports/widget-registry';
import { getMetricDefinition, metricScopeLabel } from '@/lib/metric-contract';

interface WidgetLibraryProps {
  isOpen: boolean;
  onClose: () => void;
  onAddWidget: (widget: WidgetDefinition) => void;
  existingWidgetKeys?: string[];
}

const CATEGORY_ICONS: Record<WidgetCategory, React.ElementType> = {
  metrics: TrendingUp,
  charts: BarChart2,
  tables: Table2,
  special: Sparkles,
};

const CATEGORY_LABELS: Record<WidgetCategory, string> = {
  metrics: 'Metric Cards & Gauges',
  charts: 'Charts & Graphs',
  tables: 'Data Tables',
  special: 'Special Widgets',
};

const CATEGORY_DESCRIPTIONS: Record<WidgetCategory, string> = {
  metrics: 'KPIs with trend indicators and gauges',
  charts: 'Line, bar, and heatmap visualizations',
  tables: 'Tabular data for detailed analysis',
  special: 'AI insights and on-call info',
};

// Widget type icons
function getWidgetIcon(id: string): React.ElementType {
  if (id.includes('incident') || id.includes('alert')) return AlertTriangle;
  if (id.includes('mtta') || id.includes('mttr') || id.includes('time')) return Clock;
  if (id.includes('compliance') || id.includes('sla')) return Shield;
  if (id.includes('resolve') || id.includes('ack')) return CheckCircle;
  if (
    id.includes('team') ||
    id.includes('assignee') ||
    id.includes('user') ||
    id.includes('on-call')
  )
    return Users;
  if (id.includes('service')) return Server;
  if (id.includes('insight') || id.includes('smart')) return Sparkles;
  return Activity;
}

const WidgetLibrary = memo(function WidgetLibrary({
  isOpen,
  onClose,
  onAddWidget,
  existingWidgetKeys = [],
}: WidgetLibraryProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<WidgetCategory | 'all'>('all');

  const allWidgets = useMemo(() => getAllWidgets(), []);
  const categories: WidgetCategory[] = ['metrics', 'charts', 'tables', 'special'];

  // Filter widgets based on search and category
  const filteredWidgets = useMemo(() => {
    let widgets = selectedCategory === 'all' ? allWidgets : getWidgetsByCategory(selectedCategory);

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      widgets = widgets.filter(
        w =>
          w.name.toLowerCase().includes(query) ||
          w.description.toLowerCase().includes(query) ||
          w.id.toLowerCase().includes(query)
      );
    }

    return widgets;
  }, [allWidgets, selectedCategory, searchQuery]);

  // Group by category for display
  const groupedWidgets = useMemo(() => {
    if (selectedCategory !== 'all') {
      return { [selectedCategory]: filteredWidgets };
    }

    const grouped: Partial<Record<WidgetCategory, WidgetDefinition[]>> = {};
    for (const widget of filteredWidgets) {
      if (!grouped[widget.category]) {
        grouped[widget.category] = [];
      }
      grouped[widget.category]!.push(widget);
    }
    return grouped;
  }, [filteredWidgets, selectedCategory]);

  if (!isOpen) return null;

  const handleAddWidget = (widget: WidgetDefinition) => {
    onAddWidget(widget);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold">Widget Library</h2>
            <p className="text-sm text-muted-foreground">Choose widgets to add to your dashboard</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search & Filters */}
        <div className="p-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-4">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search widgets..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Category Filter */}
            <div className="flex items-center gap-1 bg-background border border-input rounded-lg p-1">
              <button
                onClick={() => setSelectedCategory('all')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  selectedCategory === 'all'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                All
              </button>
              {categories.map(cat => {
                const Icon = CATEGORY_ICONS[cat];
                return (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                      selectedCategory === cat
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    title={CATEGORY_LABELS[cat]}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="hidden lg:inline">{CATEGORY_LABELS[cat]}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Widget Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {Object.entries(groupedWidgets).map(([category, widgets]) => (
            <div key={category} className="mb-6 last:mb-0">
              {selectedCategory === 'all' && (
                <div className="flex items-center gap-2 mb-3">
                  {(() => {
                    const Icon = CATEGORY_ICONS[category as WidgetCategory];
                    return <Icon className="h-4 w-4 text-primary" />;
                  })()}
                  <h3 className="font-medium">{CATEGORY_LABELS[category as WidgetCategory]}</h3>
                  <span className="text-xs text-muted-foreground">({widgets.length} widgets)</span>
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {widgets.map(widget => {
                  const isAdded = existingWidgetKeys.includes(widget.metricKey);
                  const Icon = getWidgetIcon(widget.id);
                  const metricDefinition = getMetricDefinition(widget.metricKey);

                  return (
                    <button
                      key={widget.id}
                      onClick={() => !isAdded && handleAddWidget(widget)}
                      disabled={isAdded}
                      className={`group relative p-3 border rounded-lg text-left transition-all ${
                        isAdded
                          ? 'border-primary/30 bg-primary/5 opacity-60 cursor-not-allowed'
                          : 'border-border hover:border-primary hover:bg-primary/5 cursor-pointer'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div
                          className={`p-1.5 rounded-md ${
                            isAdded ? 'bg-primary/20' : 'bg-muted group-hover:bg-primary/20'
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{widget.name}</div>
                          <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                            {metricDefinition?.description || widget.description}
                          </div>
                          {metricDefinition && (
                            <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-primary/80">
                              {metricScopeLabel(metricDefinition.scope)}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Add indicator */}
                      {isAdded ? (
                        <div className="absolute top-2 right-2">
                          <CheckCircle className="h-4 w-4 text-primary" />
                        </div>
                      ) : (
                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Plus className="h-4 w-4 text-primary" />
                        </div>
                      )}

                      {/* Size indicator */}
                      <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
                        <span className="px-1.5 py-0.5 bg-muted rounded">
                          {widget.defaultSize.w}×{widget.defaultSize.h}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {filteredWidgets.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Search className="h-12 w-12 mb-4 opacity-30" />
              <p className="text-sm">No widgets found matching your search</p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('all');
                }}
                className="mt-2 text-xs text-primary hover:underline"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border bg-muted/30 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {filteredWidgets.length} widgets available
            {existingWidgetKeys.length > 0 && (
              <span> • {existingWidgetKeys.length} already added</span>
            )}
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
});

export default WidgetLibrary;
