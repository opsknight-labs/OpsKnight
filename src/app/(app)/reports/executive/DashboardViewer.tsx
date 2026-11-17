'use client';

import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
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
  Clock,
  Sparkles,
  Plus,
  Trash2,
  Loader2,
  Check,
  RotateCcw,
  Minimize2,
  RefreshCw,
  Tv,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { FilterBar, FilterField, PageHeader } from '@/components/patterns';
import { pageHeaderActionClass, pageHeaderBadgeClass } from '@/components/patterns/PageHeader';
import DeleteConfirmDialog from '@/components/ui/DeleteConfirmDialog';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import type { SerializedSLAMetrics } from '@/lib/sla';
import type { DashboardTemplate } from '@/lib/reports/dashboard-templates';
import type { WidgetDefinition } from '@/lib/reports/widget-registry';
import WidgetLibrary from '@/components/reports/WidgetLibrary';
import DashboardShareModal from '@/components/reports/DashboardShareModal';
import WidgetConfigModal, { ConfigurableWidget } from '@/components/reports/WidgetConfigModal';

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

const subscribeNoop = () => () => {};

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
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // Share modal state
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const initialVisibility =
    (savedDashboards.find(d => d.id === dashboardId)?.visibility as
      'PRIVATE' | 'TEAM' | 'PUBLIC' | undefined) || 'PRIVATE';
  const [currentVisibility, setCurrentVisibility] = useState<'PRIVATE' | 'TEAM' | 'PUBLIC'>(
    initialVisibility
  );

  // Widget configuration modal state
  const [configuringWidget, setConfiguringWidget] = useState<ConfigurableWidget | null>(null);

  // Auto-refresh interval (0 = off, 30s, 60s, 300s)
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(0);
  const [refreshCountdown, setRefreshCountdown] = useState<number>(0);

  // NOC / Kiosk presentation mode
  const [isKioskMode, setIsKioskMode] = useState(false);

  // Reset local state when the dashboard/template props change (adjusting state during render).
  const [syncedProps, setSyncedProps] = useState({
    dashboardId,
    currentTemplateId,
    widgets,
    dashboardName,
    dashboardDescription,
    savedDashboards,
  });
  if (
    syncedProps.dashboardId !== dashboardId ||
    syncedProps.currentTemplateId !== currentTemplateId ||
    syncedProps.widgets !== widgets ||
    syncedProps.dashboardName !== dashboardName ||
    syncedProps.dashboardDescription !== dashboardDescription ||
    syncedProps.savedDashboards !== savedDashboards
  ) {
    setSyncedProps({
      dashboardId,
      currentTemplateId,
      widgets,
      dashboardName,
      dashboardDescription,
      savedDashboards,
    });
    setSavedBaseline(widgets);
    setLocalWidgets(widgets);
    setDashboardTitle(dashboardName);
    setDashboardDesc(dashboardDescription);
    const vis = savedDashboards.find(d => d.id === dashboardId)?.visibility;
    if (vis === 'PRIVATE' || vis === 'TEAM' || vis === 'PUBLIC') {
      setCurrentVisibility(vis);
    }
  }

  // Auto-refresh timer with visibility detection
  const changeAutoRefresh = useCallback((seconds: number) => {
    setAutoRefreshInterval(seconds);
    setRefreshCountdown(seconds > 0 ? seconds : 0);
  }, []);

  useEffect(() => {
    if (autoRefreshInterval <= 0) return;

    const intervalId = setInterval(() => {
      // Pause countdown when document is in background to preserve resources
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }

      setRefreshCountdown(prev => {
        if (prev <= 1) {
          router.refresh();
          return autoRefreshInterval;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(intervalId);
  }, [autoRefreshInterval, router]);

  // The wallboard renders in a portal on document.body so `.content-shell`'s overflow never
  // clips it; this is false during SSR and the first hydration pass.
  const isClient = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false
  );

  useEffect(() => {
    // Lock body scroll when kiosk overlay is active so the app shell doesn't scroll behind it.
    if (isKioskMode) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isKioskMode]);

  // Live clock for TV / Wallboard mode
  const [wallboardClock, setWallboardClock] = useState<string>('');
  useEffect(() => {
    if (!isKioskMode) return;
    const updateClock = () => {
      const now = new Date();
      setWallboardClock(
        now.toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
    };
    const first = setTimeout(updateClock, 0);
    const id = setInterval(updateClock, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [isKioskMode]);

  const enterKioskMode = useCallback(async () => {
    setIsKioskMode(true);
    if (autoRefreshInterval === 0) {
      changeAutoRefresh(60);
    }
    try {
      if (
        typeof document !== 'undefined' &&
        !document.fullscreenElement &&
        document.documentElement.requestFullscreen
      ) {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Browser permissions or security might reject requestFullscreen, ignore
    }
  }, [autoRefreshInterval, changeAutoRefresh]);

  const exitKioskMode = useCallback(async () => {
    setIsKioskMode(false);
    try {
      if (
        typeof document !== 'undefined' &&
        document.fullscreenElement &&
        document.exitFullscreen
      ) {
        await document.exitFullscreen();
      }
    } catch {
      // Ignore
    }
  }, []);

  const toggleKioskMode = useCallback(() => {
    if (isKioskMode) {
      void exitKioskMode();
    } else {
      void enterKioskMode();
    }
  }, [isKioskMode, enterKioskMode, exitKioskMode]);

  // Sync with native fullscreen changes (e.g. user pressed Esc on browser)
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (typeof document !== 'undefined' && !document.fullscreenElement && isKioskMode) {
        setIsKioskMode(false);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [isKioskMode]);

  // Fullscreen / Kiosk keyboard shortcut (F to toggle, Esc to exit)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable
      ) {
        return;
      }

      if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        toggleKioskMode();
      } else if (e.key === 'Escape' && isKioskMode) {
        void exitKioskMode();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isKioskMode, toggleKioskMode, exitKioskMode]);

  const handleExportPdf = () => {
    try {
      window.print();
    } catch {
      notify.error('Could not open print dialog. Please try again.');
    }
  };

  const handleSaveWidgetConfig = (updatedWidget: ConfigurableWidget) => {
    setLocalWidgets(prev =>
      prev.map(w => (w.id === updatedWidget.id ? (updatedWidget as Widget) : w))
    );
    notify.success('Widget settings updated. Click "Save Changes" to persist.');
  };

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

    const basePath = dashboardId ? `/reports/executive/${dashboardId}` : '/reports/executive';
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
      if (data.dashboard?.description !== undefined)
        setDashboardDesc(data.dashboard.description || '');
      setIsEditing(false);
      notify.success('Dashboard saved successfully');
    } catch (error) {
      console.error('Failed to save dashboard:', error);
      notify.error(error instanceof Error ? error.message : 'Failed to save dashboard');
    } finally {
      setIsSaving(false);
    }
  };

  const myDashboards = savedDashboards.filter(d => !currentUserId || d.userId === currentUserId);
  const sharedWithMe = savedDashboards.filter(d => currentUserId && d.userId !== currentUserId);

  const handleDeleteDashboard = async () => {
    if (!dashboardId) return;
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/dashboards/${dashboardId}`, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error('Failed to delete dashboard');
      }
      setConfirmDeleteOpen(false);
      router.push('/reports');
    } catch (error) {
      console.error('Failed to delete dashboard:', error);
      notify.error('Failed to delete dashboard. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className={cn(
        'mx-auto w-full max-w-[1600px] px-4 py-6 md:px-6 md:py-8 space-y-6 transition-all print:p-0 print:space-y-4',
        isEditing && 'pb-28'
      )}
    >
      {/* Executive Print Header (Visible in Print / PDF Only) */}
      <div className="executive-print-header hidden print:block">
        <div className="flex items-start justify-between border-b-2 border-slate-300 pb-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm uppercase tracking-wider font-extrabold text-blue-600">
                OpsKnight
              </span>
              <span className="text-slate-300">|</span>
              <span className="text-lg font-bold tracking-tight text-slate-900">
                Executive Reliability & Operations Report
              </span>
            </div>
            <div className="text-base font-bold text-slate-800 mt-1">
              Dashboard: {dashboardTitle}
            </div>
            {dashboardDesc && (
              <p className="text-xs text-slate-600 mt-0.5 max-w-2xl">
                Description: {dashboardDesc}
              </p>
            )}
          </div>
          <div className="text-right text-xs text-slate-600 space-y-1">
            <div className="font-semibold text-slate-800">Generated: {lastUpdated}</div>
            <div>
              <span className="font-medium text-slate-700">Scope:</span>{' '}
              {TIME_WINDOWS.find(w => w.value === String(currentFilters.windowDays))?.label ||
                `${currentFilters.windowDays} days`}
              {currentFilters.teamId &&
                ` • Team: ${filterOptions.teams.find(t => t.id === currentFilters.teamId)?.name || currentFilters.teamId}`}
              {currentFilters.serviceId &&
                ` • Service: ${filterOptions.services.find(s => s.id === currentFilters.serviceId)?.name || currentFilters.serviceId}`}
            </div>
          </div>
        </div>
      </div>

      {/* TV / NOC Wallboard Full-Screen Takeover — rendered via portal at document.body
          so it is NEVER clipped by overflow-y:auto on .content-shell */}
      {isClient &&
        isKioskMode &&
        createPortal(
          <div
            role="region"
            aria-label="NOC Wallboard Presentation"
            className="fixed inset-0 z-[99999] bg-[#09090b] text-zinc-100 overflow-y-auto flex flex-col p-4 sm:p-6 lg:p-8 space-y-6 animate-in fade-in duration-200 print:hidden"
            style={{ zIndex: 99999 }}
          >
            {/* Wallboard Top Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-zinc-800/80 bg-zinc-950/60 -mx-4 -mt-4 sm:-mx-6 sm:-mt-6 lg:-mx-8 lg:-mt-8 p-4 sm:p-6 lg:p-8 backdrop-blur-md sticky top-0 z-10">
              {/* Left: Branding & Status */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold select-none shadow-xs">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                  </span>
                  <span className="tracking-wider">NOC Wallboard</span>
                  <span className="text-zinc-600">•</span>
                  <span className="text-emerald-400 font-bold">LIVE</span>
                </div>
                {wallboardClock && (
                  <div className="font-mono text-xs text-zinc-300 bg-zinc-900/90 px-2.5 py-1 rounded-md border border-zinc-800 shadow-xs">
                    {wallboardClock}
                  </div>
                )}
              </div>

              {/* Center: Title & Scope */}
              <div className="flex flex-col items-center text-center">
                <div className="text-lg md:text-xl font-bold tracking-tight text-white flex items-center gap-2">
                  {dashboardTitle}
                  {isTemplate && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-800 text-amber-400 border border-zinc-700">
                      <Sparkles className="h-2.5 w-2.5" />
                      Template
                    </span>
                  )}
                </div>
                <div className="text-xs text-zinc-400 flex items-center gap-2 mt-0.5">
                  <span>
                    {TIME_WINDOWS.find(w => w.value === String(currentFilters.windowDays))?.label ||
                      `${currentFilters.windowDays}d`}
                  </span>
                  <span>•</span>
                  <span>
                    {currentFilters.teamId
                      ? filterOptions.teams.find(t => t.id === currentFilters.teamId)?.name ||
                        'Team'
                      : 'All Teams'}
                  </span>
                  <span>•</span>
                  <span>
                    {currentFilters.serviceId
                      ? filterOptions.services.find(s => s.id === currentFilters.serviceId)?.name ||
                        'Service'
                      : 'All Services'}
                  </span>
                  <span>•</span>
                  <span>{localWidgets.length} widgets</span>
                </div>
              </div>

              {/* Right: Controls & Exit */}
              <div className="flex items-center gap-2.5">
                {/* Auto Refresh pill & control */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        'bg-zinc-900/90 border-zinc-700/80 text-zinc-200 hover:text-white gap-1.5 text-xs font-medium h-9',
                        autoRefreshInterval > 0 &&
                          'border-emerald-500/50 text-emerald-400 bg-emerald-500/10'
                      )}
                    >
                      <RefreshCw
                        className={cn(
                          'h-3.5 w-3.5',
                          autoRefreshInterval > 0 && 'animate-spin [animation-duration:3s]'
                        )}
                      />
                      <span>{autoRefreshInterval > 0 ? `${refreshCountdown}s` : 'Manual'}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="bg-zinc-900 border-zinc-800 text-zinc-200"
                  >
                    <div className="px-2 py-1 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                      Auto-Refresh Interval
                    </div>
                    <DropdownMenuItem onClick={() => changeAutoRefresh(0)}>
                      <span>Off (Manual)</span>
                      {autoRefreshInterval === 0 && (
                        <Check className="h-4 w-4 ml-auto text-primary" />
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => changeAutoRefresh(30)}>
                      <span>Every 30 seconds</span>
                      {autoRefreshInterval === 30 && (
                        <Check className="h-4 w-4 ml-auto text-primary" />
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => changeAutoRefresh(60)}>
                      <span>Every 1 minute</span>
                      {autoRefreshInterval === 60 && (
                        <Check className="h-4 w-4 ml-auto text-primary" />
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => changeAutoRefresh(300)}>
                      <span>Every 5 minutes</span>
                      {autoRefreshInterval === 300 && (
                        <Check className="h-4 w-4 ml-auto text-primary" />
                      )}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => router.refresh()}
                  className="bg-zinc-900/90 border-zinc-700/80 text-zinc-200 hover:text-white h-9 px-2.5"
                  title="Refresh metrics now"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>

                {/* Exit TV Mode Button */}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={exitKioskMode}
                  className="bg-zinc-900/90 hover:bg-zinc-800 border-zinc-700 text-zinc-200 hover:text-white font-medium text-xs h-9 gap-1.5"
                >
                  <Minimize2 className="h-3.5 w-3.5" />
                  <span>Exit (Esc)</span>
                </Button>
              </div>
            </div>

            {/* NOC Grid Area */}
            <div className="flex-1 w-full max-w-[1920px] mx-auto">
              <DashboardGrid
                widgets={localWidgets}
                metrics={metrics}
                isEditing={false}
                isLoading={false}
                columns={layout?.columns ?? 4}
                rowHeight={layout?.rowHeight ?? 150}
                gap={16}
              />
            </div>
          </div>,
          document.body
        )}

      <PageHeader
        className="print:hidden"
        title={dashboardTitle || 'Untitled dashboard'}
        icon={LayoutDashboard}
        badges={
          isTemplate ? (
            <span className={pageHeaderBadgeClass}>
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              Template
            </span>
          ) : undefined
        }
        description={
          <div className="space-y-1">
            {dashboardDesc && <span className="block">{dashboardDesc}</span>}
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 tabular-nums text-zinc-400">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                Updated {lastUpdated}
              </span>
              <span aria-hidden="true">·</span>
              <span>{localWidgets.length} widgets</span>
            </span>
          </div>
        }
        secondaryActions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    pageHeaderActionClass,
                    autoRefreshInterval > 0 && 'border-emerald-500/50 text-emerald-300'
                  )}
                  aria-label={
                    autoRefreshInterval > 0
                      ? `Auto-refresh every ${autoRefreshInterval} seconds, next in ${refreshCountdown} seconds`
                      : 'Auto-refresh off'
                  }
                >
                  <RefreshCw
                    aria-hidden="true"
                    className={cn(
                      autoRefreshInterval > 0 &&
                        'motion-safe:animate-spin motion-safe:[animation-duration:3s]'
                    )}
                  />
                  <span className="tabular-nums">
                    {autoRefreshInterval > 0 ? `${refreshCountdown}s` : 'Live'}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                  Auto-refresh interval
                </div>
                {[
                  { seconds: 0, label: 'Off' },
                  { seconds: 30, label: 'Every 30 seconds' },
                  { seconds: 60, label: 'Every 1 minute' },
                  { seconds: 300, label: 'Every 5 minutes' },
                ].map(option => (
                  <DropdownMenuItem
                    key={option.seconds}
                    onClick={() => changeAutoRefresh(option.seconds)}
                  >
                    <span>{option.label}</span>
                    {autoRefreshInterval === option.seconds && (
                      <Check className="ml-auto h-4 w-4" aria-hidden="true" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="outline"
              size="icon"
              data-icon-button=""
              className={cn(pageHeaderActionClass, 'h-9 w-9')}
              onClick={toggleKioskMode}
              aria-label={isKioskMode ? 'Exit presentation mode' : 'Presentation mode'}
              title={isKioskMode ? 'Exit Presentation Mode (Esc)' : 'Presentation Mode (Press F)'}
            >
              {isKioskMode ? <Minimize2 aria-hidden="true" /> : <Tv aria-hidden="true" />}
            </Button>

            <Button
              variant="outline"
              size="sm"
              className={pageHeaderActionClass}
              onClick={handleExportPdf}
              title="Print or save as PDF"
            >
              <Download aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">Export PDF</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              className={pageHeaderActionClass}
              onClick={() => setIsShareModalOpen(true)}
              title="Share dashboard link"
            >
              <Share2 aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">Share</span>
            </Button>
          </>
        }
        primaryAction={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  data-icon-button=""
                  aria-label="Dashboard settings"
                  className={cn(pageHeaderActionClass, 'h-9 w-9')}
                >
                  <Settings aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setIsEditing(!isEditing)}>
                  <LayoutDashboard className="mr-2 h-4 w-4" aria-hidden="true" />
                  {isEditing ? 'Exit Edit Mode' : 'Edit Dashboard'}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={toggleKioskMode}>
                  <Tv className="mr-2 h-4 w-4" aria-hidden="true" />
                  {isKioskMode ? 'Exit Presentation Mode' : 'Presentation Mode (F)'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleExportPdf}>
                  <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                  Export as PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setIsShareModalOpen(true)}>
                  <Share2 className="mr-2 h-4 w-4" aria-hidden="true" />
                  Share Dashboard
                </DropdownMenuItem>
                {!isTemplate && dashboardId && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => setConfirmDeleteOpen(true)}
                      disabled={isDeleting}
                    >
                      <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                      {isDeleting ? 'Deleting…' : 'Delete Dashboard'}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {isTemplate && (
              <Button onClick={handleCloneDashboard} loading={isCloning}>
                <Copy aria-hidden="true" />
                {isCloning ? 'Cloning…' : 'Clone Dashboard'}
              </Button>
            )}
          </>
        }
      />

      {isEditing && dashboardId && (
        <section
          aria-label="Dashboard details"
          className="grid gap-3 rounded-lg border border-border bg-card p-4 shadow-sm sm:grid-cols-2 print:hidden"
        >
          <div className="space-y-1.5">
            <Label htmlFor="dashboard-title">Title</Label>
            <Input
              id="dashboard-title"
              value={dashboardTitle}
              onChange={e => setDashboardTitle(e.target.value)}
              placeholder="Dashboard title"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dashboard-description">Description</Label>
            <Input
              id="dashboard-description"
              value={dashboardDesc}
              onChange={e => setDashboardDesc(e.target.value)}
              placeholder="Dashboard description"
            />
          </div>
        </section>
      )}

      <FilterBar
        className="print:hidden"
        hasActiveFilters={Boolean(
          currentFilters.teamId || currentFilters.serviceId || currentFilters.windowDays !== 7
        )}
        clearLabel="Reset"
        onClearAll={() => {
          const basePath = dashboardId ? `/reports/executive/${dashboardId}` : '/reports/executive';
          const params = new URLSearchParams();
          if (currentTemplateId && !dashboardId) params.set('template', currentTemplateId);
          const qs = params.toString();
          router.push(`${basePath}${qs ? `?${qs}` : ''}`);
        }}
        filters={
          <>
            <FilterField label="Time window" htmlFor="executive-filter-window">
              <Select
                value={String(currentFilters.windowDays)}
                onValueChange={value => handleFilterChange('window', value)}
              >
                <SelectTrigger
                  id="executive-filter-window"
                  className="h-9 w-full bg-background text-sm"
                  aria-label="Time range"
                >
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
            </FilterField>

            <FilterField label="Team" htmlFor="executive-filter-team">
              <Select
                value={currentFilters.teamId || 'ALL'}
                onValueChange={value => handleFilterChange('teamId', value)}
              >
                <SelectTrigger
                  id="executive-filter-team"
                  className="h-9 w-full bg-background text-sm"
                  aria-label="Filter by team"
                >
                  <SelectValue placeholder="All teams" />
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
            </FilterField>

            <FilterField label="Service" htmlFor="executive-filter-service">
              <Select
                value={currentFilters.serviceId || 'ALL'}
                onValueChange={value => handleFilterChange('serviceId', value)}
              >
                <SelectTrigger
                  id="executive-filter-service"
                  className="h-9 w-full bg-background text-sm"
                  aria-label="Filter by service"
                >
                  <SelectValue placeholder="All services" />
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
            </FilterField>
          </>
        }
        actions={
          <FilterField
            label="Dashboard"
            htmlFor="executive-dashboard-select"
            className="min-w-[14rem]"
          >
            <Select
              value={
                dashboardId
                  ? `saved:${dashboardId}`
                  : `template:${currentTemplateId || 'executive-summary'}`
              }
              onValueChange={value => {
                const params = new URLSearchParams();
                if (currentFilters.windowDays !== 7)
                  params.set('window', String(currentFilters.windowDays));
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
              <SelectTrigger
                id="executive-dashboard-select"
                className="h-9 w-full bg-background text-sm"
                aria-label="Select dashboard"
              >
                <SelectValue placeholder="Select dashboard" />
              </SelectTrigger>
              <SelectContent>
                {myDashboards.length > 0 && (
                  <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                    My dashboards
                  </div>
                )}
                {myDashboards.map(d => (
                  <SelectItem key={d.id} value={`saved:${d.id}`}>
                    {d.name}
                  </SelectItem>
                ))}

                {sharedWithMe.length > 0 && (
                  <div className="mt-1.5 px-2 py-1 text-xs font-medium text-muted-foreground">
                    Team &amp; shared
                  </div>
                )}
                {sharedWithMe.map(d => (
                  <SelectItem key={d.id} value={`saved:${d.id}`}>
                    {d.name} ({d.visibility === 'TEAM' ? 'Team' : 'Public'})
                  </SelectItem>
                ))}

                <div className="mt-1.5 px-2 py-1 text-xs font-medium text-muted-foreground">
                  Templates
                </div>
                {templates.map(t => (
                  <SelectItem key={t.id} value={`template:${t.id}`}>
                    {t.name} (Template)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
        }
      />

      <DeleteConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Delete dashboard"
        description={
          <>
            Delete <strong>&quot;{dashboardTitle}&quot;</strong>? Its widgets and layout are removed
            permanently.
          </>
        }
        confirmText="Delete dashboard"
        onConfirm={handleDeleteDashboard}
      />

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
        onConfigureWidget={widgetId => {
          const w = localWidgets.find(item => item.id === widgetId);
          if (w) setConfiguringWidget(w);
        }}
      />

      {/* Edit Mode Footer */}
      {isEditing && (
        <div
          data-testid="dashboard-edit-footer"
          className="dashboard-edit-footer bg-card/95 backdrop-blur-md border-t border-border shadow-2xl transition-[left] duration-200 ease-in-out"
          style={{
            paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))',
          }}
        >
          <div className="w-full px-4 sm:px-6 py-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4">
            {/* Left section: Editor Status Badge, Widget Count & Add Widget Button */}
            <div className="flex flex-wrap items-center gap-2.5 sm:gap-3.5">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-600 dark:text-amber-400 text-xs font-semibold select-none">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                </span>
                <span>Editing mode - {localWidgets.length} widgets</span>
              </div>

              <Button
                type="button"
                size="sm"
                className="gap-1.5 font-medium shadow-xs bg-primary hover:bg-primary/90 text-primary-foreground transition-all hover:scale-[1.02] active:scale-[0.98]"
                onClick={() => setIsWidgetLibraryOpen(true)}
              >
                <Plus className="h-4 w-4" />
                <span>Add Widget</span>
              </Button>
            </div>

            {/* Right section: Unsaved Changes, Cancel & Save Changes / Done Buttons */}
            <div className="flex items-center justify-end gap-2 sm:gap-2.5">
              {isDirty && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/25 text-xs font-medium text-amber-600 dark:text-amber-400 animate-in fade-in duration-150">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                  <span>Unsaved changes</span>
                </div>
              )}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setDashboardTitle(dashboardName);
                  setDashboardDesc(dashboardDescription);
                  setLocalWidgets(savedBaseline);
                  setIsEditing(false);
                }}
                disabled={isSaving}
                className="hover:bg-muted"
              >
                Cancel
              </Button>

              {dashboardId ? (
                <Button
                  type="button"
                  size="sm"
                  className="gap-2 font-medium shadow-xs min-w-[125px]"
                  onClick={handleSaveChanges}
                  disabled={isSaving || !isDirty}
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      <span>Save Changes</span>
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  className="gap-2 font-medium shadow-xs"
                  onClick={() => setIsEditing(false)}
                >
                  <Check className="h-4 w-4" />
                  <span>Done</span>
                </Button>
              )}
            </div>
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

      {/* Share Modal */}
      <DashboardShareModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        dashboardId={dashboardId}
        dashboardName={dashboardTitle}
        isTemplate={isTemplate}
        currentVisibility={currentVisibility}
        currentFilters={currentFilters}
        onVisibilityChange={setCurrentVisibility}
      />

      {/* Widget Configuration Modal */}
      <WidgetConfigModal
        isOpen={!!configuringWidget}
        onClose={() => setConfiguringWidget(null)}
        widget={configuringWidget}
        onSave={handleSaveWidgetConfig}
      />
    </div>
  );
}
