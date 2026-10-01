'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { notify } from '@/lib/toast';
import DashboardGrid from '@/components/reports/DashboardGrid';
import { Button } from '@/components/ui/shadcn/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/shadcn/dropdown-menu';
import {
  LayoutDashboard,
  Settings,
  Download,
  Share2,
  Copy,
  Save,
  ChevronLeft,
  Clock,
  Filter,
  Sparkles,
  Plus,
  Trash2,
  Loader2,
} from 'lucide-react';
import type { SerializedSLAMetrics } from '@/lib/sla';
import type { DashboardTemplate } from '@/lib/reports/dashboard-templates';
import type { WidgetDefinition } from '@/lib/reports/widget-registry';
import WidgetLibrary from '@/components/reports/WidgetLibrary';

type Widget = {
  id: string;
  widgetType: string;
  metricKey: string;
  widgetDefinitionId?: string;
  title?: string | null;
  position: { x: number; y: number; w: number; h: number };
  config: Record<string, unknown>;
};

type DashboardViewerProps = {
  dashboardName: string;
  dashboardDescription: string;
  widgets: Widget[];
  metrics: SerializedSLAMetrics;
  lastUpdated: string;
  currentFilters: {
    windowDays: number;
    teamId?: string;
    serviceId?: string;
  };
  filterOptions: {
    teams: Array<{ id: string; name: string }>;
    services: Array<{ id: string; name: string }>;
  };
  templates: DashboardTemplate[];
  savedDashboards?: Array<{ id: string; name: string; visibility: string; userId: string }>;
  currentUserId?: string;
  currentTemplateId?: string;
  isTemplate: boolean;
  dashboardId?: string;
  layout?: { columns?: number; rowHeight?: number };
};

const TIME_WINDOWS = [
  { value: '1', label: '24 hours' },
  { value: '3', label: '3 days' },
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
  { value: '60', label: '60 days' },
  { value: '90', label: '90 days' },
];

export default function DashboardViewer({
  dashboardName,
  dashboardDescription,
  widgets,
  metrics,
  lastUpdated,
  currentFilters,
  filterOptions,
  templates,
  savedDashboards = [],
  currentUserId,
  currentTemplateId,
  isTemplate,
  dashboardId,
  layout,
}: DashboardViewerProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isWidgetLibraryOpen, setIsWidgetLibraryOpen] = useState(false);
  const [dashboardTitle, setDashboardTitle] = useState(dashboardName);
  const [dashboardDesc, setDashboardDesc] = useState(dashboardDescription);
  const [savedBaseline, setSavedBaseline] = useState(widgets);
  const [localWidgets, setLocalWidgets] = useState(widgets);
  const [isDeleting, setIsDeleting] = useState(false);

  // Sync state when dashboard/template changes
  useEffect(() => {
    setSavedBaseline(widgets);
    setLocalWidgets(widgets);
    setDashboardTitle(dashboardName);
    setDashboardDesc(dashboardDescription);
  }, [dashboardId, currentTemplateId, widgets, dashboardName, dashboardDescription]);

  const isDirty =
    JSON.stringify(localWidgets) !== JSON.stringify(savedBaseline) ||
    dashboardTitle !== dashboardName ||
    dashboardDesc !== dashboardDescription;

  // Handle adding a new widget from the library
  const handleAddWidget = (widgetDef: WidgetDefinition) => {
    // Calculate next available position
    const maxY =
      localWidgets.length > 0 ? Math.max(...localWidgets.map(w => w.position.y + w.position.h)) : 0;

    const newWidget: Widget = {
      id: `temp-${Date.now()}`,
      widgetType: widgetDef.type,
      metricKey: widgetDef.metricKey,
      widgetDefinitionId: widgetDef.id,
      title: widgetDef.name,
      position: {
        x: 0,
        y: maxY,
        w: widgetDef.defaultSize.w,
        h: widgetDef.defaultSize.h,
      },
      config: widgetDef.config ?? {},
    };

    setLocalWidgets(prev => [...prev, newWidget]);
  };

  // Get existing widget keys for the library
  const existingWidgetDefIds = localWidgets
    .map(w => w.widgetDefinitionId)
    .filter((id): id is string => !!id);

  // Clone dashboard from template
  const handleCloneDashboard = async () => {
    if (isCloning) return;
    setIsCloning(true);

    try {
      const response = await fetch('/api/dashboards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `My ${dashboardName}`,
          description: dashboardDescription,
          sourceTemplate: currentTemplateId,
          widgets: localWidgets.map(w => ({
            widgetType: w.widgetType,
            metricKey: w.metricKey,
            widgetDefinitionId: w.widgetDefinitionId,
            title: w.title,
            position: w.position,
            config: w.config,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to clone dashboard');
      }

      const data = await response.json();
      router.push(`/reports/executive/${data.dashboard.id}`);
    } catch (error) {
      console.error('Failed to clone dashboard:', error);
      notify.error('Failed to clone dashboard. Please try again.');
    } finally {
      setIsCloning(false);
    }
  };

  // Build URL with updated filter
  const buildFilterUrl = (key: string, value: string) => {
    const params = new URLSearchParams();
    if (currentTemplateId && !dashboardId) params.set('template', currentTemplateId);

    // Set all current filters
    if (key === 'window') {
      params.set('window', value);
    } else {
      if (currentFilters.windowDays !== 7) params.set('window', String(currentFilters.windowDays));
    }

    if (key === 'teamId') {
      if (value !== 'ALL') {
        params.set('teamId', value);
      }
      // Dependent filter reset: changing team clears incompatible serviceId
      params.delete('serviceId');
    } else {
      if (currentFilters.teamId) {
        params.set('teamId', currentFilters.teamId);
      }
      if (key === 'serviceId') {
        if (value !== 'ALL') params.set('serviceId', value);
      } else if (currentFilters.serviceId) {
        params.set('serviceId', currentFilters.serviceId);
      }
    }

    const basePath = dashboardId
      ? `/reports/executive/${dashboardId}`
      : '/reports/executive';
    return `${basePath}?${params.toString()}`;
  };

  const handleFilterChange = (key: string, value: string) => {
    router.push(buildFilterUrl(key, value));
  };

  const handleSaveChanges = async () => {
    if (!dashboardId || isSaving) return;
    setIsSaving(true);
    try {
      const response = await fetch(`/api/dashboards/${dashboardId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: dashboardTitle,
          description: dashboardDesc,
          widgets: localWidgets.map(w => ({
            widgetType: w.widgetType,
            metricKey: w.metricKey,
            widgetDefinitionId: w.widgetDefinitionId,
            title: w.title,
            position: w.position,
            config: w.config,
          })),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body?.error || 'Failed to save dashboard');
      }
      const data = (await response.json()) as {
        dashboard?: {
          widgets?: Widget[];
          name?: string;
          description?: string;
        };
      };
      // Update baseline to match saved state
      const updatedWidgets: Widget[] = (data.dashboard?.widgets || localWidgets).map(w => ({
        id: w.id,
        widgetType: w.widgetType,
        metricKey: w.metricKey,
        widgetDefinitionId: w.widgetDefinitionId,
        title: w.title,
        position: w.position,
        config: w.config,
      }));
      setSavedBaseline(updatedWidgets);
      setLocalWidgets(updatedWidgets);
      if (data.dashboard?.name) setDashboardTitle(data.dashboard.name);
      if (data.dashboard?.description !== undefined) setDashboardDesc(data.dashboard.description || '');
      setIsEditing(false);
      notify.success('Dashboard saved successfully');
    } catch (error) {
      console.error('Failed to save dashboard:', error);
      notify.error(error instanceof Error ? error.message : 'Failed to save dashboard');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="w-full px-4 py-6 space-y-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-xl border border-zinc-800/80 bg-gradient-to-b from-[#121216] to-[#09090b] p-4 text-zinc-100 shadow-xl ring-1 ring-white/5 md:p-6">
        <div className="pointer-events-none absolute -right-24 -top-32 h-72 w-72 rounded-full bg-white/[0.03] blur-3xl" />
        <div className="relative flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <Link
              href="/reports"
              className="mt-1 p-2 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-200 hover:text-white border border-zinc-700/80 transition-colors"
            >
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <div>
              <div className="flex items-center gap-2 mb-1">
                {isTemplate && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-800/90 text-amber-400 border border-zinc-700/80">
                    <Sparkles className="h-3 w-3" />
                    Template
                  </span>
                )}
              </div>
              {isEditing && dashboardId ? (
                <div className="space-y-1.5 mt-1 max-w-lg">
                  <input
                    type="text"
                    value={dashboardTitle}
                    onChange={e => setDashboardTitle(e.target.value)}
                    className="text-xl md:text-2xl font-bold bg-zinc-900 border border-zinc-700 rounded px-2.5 py-1 text-white w-full focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="Dashboard title"
                  />
                  <input
                    type="text"
                    value={dashboardDesc}
                    onChange={e => setDashboardDesc(e.target.value)}
                    className="text-xs md:text-sm text-zinc-300 bg-zinc-900 border border-zinc-700 rounded px-2.5 py-1 w-full focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="Dashboard description"
                  />
                </div>
              ) : (
                <>
                  <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white">
                    {dashboardTitle}
                  </h1>
                  <p className="text-xs md:text-sm text-zinc-300 mt-1">{dashboardDesc}</p>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isTemplate && (
              <Button
                variant="secondary"
                className="bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-700/80 text-zinc-200 hover:text-white font-semibold gap-2 shadow-xs transition-all"
                onClick={handleCloneDashboard}
                disabled={isCloning}
              >
                <Copy className="h-4 w-4" />
                {isCloning ? 'Cloning...' : 'Clone Dashboard'}
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  size="icon"
                  aria-label="Dashboard settings"
                  className="bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-700/80 text-zinc-200 hover:text-white"
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setIsEditing(!isEditing)}>
                  <LayoutDashboard className="h-4 w-4 mr-2" />
                  {isEditing ? 'Exit Edit Mode' : 'Edit Dashboard'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled>
                  <Download className="h-4 w-4 mr-2" />
                  Export as PDF
                </DropdownMenuItem>
                <DropdownMenuItem disabled>
                  <Share2 className="h-4 w-4 mr-2" />
                  Share Dashboard
                </DropdownMenuItem>
                {!isTemplate && dashboardId && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={async () => {
                        if (
                          // eslint-disable-next-line no-alert
                          !confirm(
                            'Are you sure you want to delete this dashboard? This action cannot be undone.'
                          )
                        ) {
                          return;
                        }
                        setIsDeleting(true);
                        try {
                          const response = await fetch(`/api/dashboards/${dashboardId}`, {
                            method: 'DELETE',
                          });
                          if (!response.ok) {
                            throw new Error('Failed to delete dashboard');
                          }
                          router.push('/reports');
                        } catch (error) {
                          console.error('Failed to delete dashboard:', error);
                          notify.error('Failed to delete dashboard. Please try again.');
                        } finally {
                          setIsDeleting(false);
                        }
                      }}
                      disabled={isDeleting}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      {isDeleting ? 'Deleting...' : 'Delete Dashboard'}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Status Bar */}
        <div className="flex items-center gap-4 mt-4 text-sm opacity-80">
          <span className="flex items-center gap-1">
            <Clock className="h-4 w-4" />
            Updated: {lastUpdated}
          </span>
          <span>•</span>
          <span>{localWidgets.length} widgets</span>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-3 p-4 bg-card rounded-lg border">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Filter className="h-4 w-4" />
          <span>Filters:</span>
        </div>

        {/* Time Window */}
        <Select
          value={String(currentFilters.windowDays)}
          onValueChange={value => handleFilterChange('window', value)}
        >
          <SelectTrigger className="w-[130px]" aria-label="Time range">
            <SelectValue placeholder="Time range" />
          </SelectTrigger>
          <SelectContent>
            {TIME_WINDOWS.map(w => (
              <SelectItem key={w.value} value={w.value}>
                {w.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Team Filter */}
        <Select
          value={currentFilters.teamId || 'ALL'}
          onValueChange={value => handleFilterChange('teamId', value)}
        >
          <SelectTrigger className="w-[150px]" aria-label="Filter by team">
            <SelectValue placeholder="All Teams" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Teams</SelectItem>
            {filterOptions.teams.map(team => (
              <SelectItem key={team.id} value={team.id}>
                {team.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Service Filter */}
        <Select
          value={currentFilters.serviceId || 'ALL'}
          onValueChange={value => handleFilterChange('serviceId', value)}
        >
          <SelectTrigger className="w-[150px]" aria-label="Filter by service">
            <SelectValue placeholder="All Services" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Services</SelectItem>
            {filterOptions.services.map(service => (
              <SelectItem key={service.id} value={service.id}>
                {service.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Dashboard & Template Selector */}
        <div className="ml-auto">
          <Select
            value={dashboardId ? `saved:${dashboardId}` : `template:${currentTemplateId || 'executive-summary'}`}
            onValueChange={value => {
              const params = new URLSearchParams();
              if (currentFilters.windowDays !== 7) params.set('window', String(currentFilters.windowDays));
              if (currentFilters.teamId) params.set('teamId', currentFilters.teamId);
              if (currentFilters.serviceId) params.set('serviceId', currentFilters.serviceId);
              const qs = params.toString();

              if (value.startsWith('saved:')) {
                const targetId = value.replace('saved:', '');
                router.push(`/reports/executive/${targetId}${qs ? `?${qs}` : ''}`);
              } else if (value.startsWith('template:')) {
                const targetTemplate = value.replace('template:', '');
                params.set('template', targetTemplate);
                router.push(`/reports/executive?${params.toString()}`);
              }
            }}
          >
            <SelectTrigger className="w-[220px]" aria-label="Select dashboard">
              <SelectValue placeholder="Select dashboard" />
            </SelectTrigger>
            <SelectContent>
              {savedDashboards.filter(d => !currentUserId || d.userId === currentUserId).length > 0 && (
                <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  My Dashboards
                </div>
              )}
              {savedDashboards
                .filter(d => !currentUserId || d.userId === currentUserId)
                .map(d => (
                  <SelectItem key={d.id} value={`saved:${d.id}`}>
                    {d.name}
                  </SelectItem>
                ))}

              {savedDashboards.filter(d => currentUserId && d.userId !== currentUserId).length > 0 && (
                <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mt-1.5">
                  Team & Shared
                </div>
              )}
              {savedDashboards
                .filter(d => currentUserId && d.userId !== currentUserId)
                .map(d => (
                  <SelectItem key={d.id} value={`saved:${d.id}`}>
                    {d.name} ({d.visibility === 'TEAM' ? 'Team' : 'Public'})
                  </SelectItem>
                ))}

              <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mt-1.5">
                Templates
              </div>
              {templates.map(t => (
                <SelectItem key={t.id} value={`template:${t.id}`}>
                  {t.name} (Template)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Dashboard Grid */}
      <DashboardGrid
        widgets={localWidgets}
        metrics={metrics}
        isEditing={isEditing}
        isLoading={false}
        columns={layout?.columns ?? 4}
        rowHeight={layout?.rowHeight ?? 150}
        gap={16}
        onAddWidget={() => setIsWidgetLibraryOpen(true)}
        onUpdateLayout={newWidgets => setLocalWidgets(newWidgets)}
        onRemoveWidget={widgetId => setLocalWidgets(prev => prev.filter(w => w.id !== widgetId))}
      />

      {/* Edit Mode Footer */}
      {isEditing && (
        <div className="fixed bottom-0 left-0 right-0 bg-card border-t p-4 flex items-center justify-between shadow-lg z-50">
          <div className="flex items-center gap-4">
            <div className="text-sm text-muted-foreground">
              Editing mode - {localWidgets.length} widgets
            </div>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => setIsWidgetLibraryOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Add Widget
            </Button>
          </div>
          <div className="flex gap-2">
            {isDirty && (
              <span className="text-xs text-amber-400 self-center mr-1">Unsaved changes</span>
            )}
            <Button
              variant="outline"
              onClick={() => {
                setDashboardTitle(dashboardName);
                setDashboardDesc(dashboardDescription);
                setLocalWidgets(savedBaseline);
                setIsEditing(false);
              }}
            >
              Cancel
            </Button>
            {dashboardId ? (
              <Button
                className="gap-2"
                onClick={handleSaveChanges}
                disabled={isSaving || !isDirty}
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            ) : (
              <Button
                className="gap-2"
                onClick={() => setIsEditing(false)}
              >
                <Save className="h-4 w-4" />
                Done
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Widget Library Modal */}
      <WidgetLibrary
        isOpen={isWidgetLibraryOpen}
        onClose={() => setIsWidgetLibraryOpen(false)}
        onAddWidget={handleAddWidget}
        existingWidgetDefIds={existingWidgetDefIds}
      />
    </div>
  );
}
