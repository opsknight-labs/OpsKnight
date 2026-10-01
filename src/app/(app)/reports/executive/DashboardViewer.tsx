'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
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
  Pencil,
  Check,
  RotateCcw,
  Minimize2,
  RefreshCw,
  Tv,
} from 'lucide-react';
import { cn } from '@/lib/utils';
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

  // Share modal state
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const initialVisibility =
    (savedDashboards.find(d => d.id === dashboardId)?.visibility as
      | 'PRIVATE'
      | 'TEAM'
      | 'PUBLIC'
      | undefined) || 'PRIVATE';
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

  // Sync state when dashboard/template changes
  useEffect(() => {
    setSavedBaseline(widgets);
    setLocalWidgets(widgets);
    setDashboardTitle(dashboardName);
    setDashboardDesc(dashboardDescription);
    const vis = savedDashboards.find(d => d.id === dashboardId)?.visibility;
    if (vis === 'PRIVATE' || vis === 'TEAM' || vis === 'PUBLIC') {
      setCurrentVisibility(vis);
    }
  }, [dashboardId, currentTemplateId, widgets, dashboardName, dashboardDescription, savedDashboards]);

  // Auto-refresh timer with visibility detection
  useEffect(() => {
    if (autoRefreshInterval <= 0) {
      setRefreshCountdown(0);
      return;
    }

    setRefreshCountdown(autoRefreshInterval);

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

  // Portal mount: track whether we are safely client-side so createPortal can run.
  // Also lock document.body scroll to prevent the hidden content-shell from scrolling behind.
  const [portalMounted, setPortalMounted] = useState(false);
  const portalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Create and attach the portal host div to body once on the client.
    const el = document.createElement('div');
    el.id = 'kiosk-portal-root';
    document.body.appendChild(el);
    portalRef.current = el;
    setPortalMounted(true);
    return () => {
      document.body.removeChild(el);
      portalRef.current = null;
    };
  }, []);

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
    updateClock();
    const id = setInterval(updateClock, 1000);
    return () => clearInterval(id);
  }, [isKioskMode]);

  const enterKioskMode = useCallback(async () => {
    setIsKioskMode(true);
    if (autoRefreshInterval === 0) {
      setAutoRefreshInterval(60);
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
  }, [autoRefreshInterval]);

  const exitKioskMode = useCallback(async () => {
    setIsKioskMode(false);
    try {
      if (typeof document !== 'undefined' && document.fullscreenElement && document.exitFullscreen) {
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
    <div
      className={cn(
        'w-full px-4 py-6 space-y-6 transition-all print:p-0 print:space-y-4',
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
      {portalMounted &&
        isKioskMode &&
        portalRef.current &&
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
                      ? filterOptions.teams.find(t => t.id === currentFilters.teamId)?.name || 'Team'
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
                  <DropdownMenuContent align="end" className="bg-zinc-900 border-zinc-800 text-zinc-200">
                    <div className="px-2 py-1 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                      Auto-Refresh Interval
                    </div>
                    <DropdownMenuItem onClick={() => setAutoRefreshInterval(0)}>
                      <span>Off (Manual)</span>
                      {autoRefreshInterval === 0 && (
                        <Check className="h-4 w-4 ml-auto text-primary" />
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setAutoRefreshInterval(30)}>
                      <span>Every 30 seconds</span>
                      {autoRefreshInterval === 30 && (
                        <Check className="h-4 w-4 ml-auto text-primary" />
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setAutoRefreshInterval(60)}>
                      <span>Every 1 minute</span>
                      {autoRefreshInterval === 60 && (
                        <Check className="h-4 w-4 ml-auto text-primary" />
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setAutoRefreshInterval(300)}>
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
          portalRef.current
        )}

      {/* Header */}
      <div
        className={cn(
          'relative overflow-hidden rounded-xl border border-zinc-800/80 bg-gradient-to-b from-[#121216] to-[#09090b] p-4 text-zinc-100 shadow-xl ring-1 ring-white/5 md:p-6 transition-all print:hidden',
          isKioskMode && 'py-3'
        )}
      >
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
                <div className="space-y-2 mt-1 max-w-lg">
                  <div className="relative">
                    <input
                      type="text"
                      value={dashboardTitle}
                      onChange={e => setDashboardTitle(e.target.value)}
                      className="text-xl md:text-2xl font-bold bg-black/40 border border-white/20 rounded-lg px-3 py-1.5 text-white w-full focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary placeholder-white/40 transition-all shadow-inner"
                      placeholder="Dashboard title"
                    />
                    <Pencil className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40 pointer-events-none" />
                  </div>
                  <input
                    type="text"
                    value={dashboardDesc}
                    onChange={e => setDashboardDesc(e.target.value)}
                    className="text-xs md:text-sm text-zinc-200 bg-black/40 border border-white/20 rounded-lg px-3 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary placeholder-white/40 transition-all shadow-inner"
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

          <div className="flex flex-wrap items-center gap-2">
            {isTemplate && (
              <Button
                variant="secondary"
                className="bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-700/80 text-zinc-200 hover:text-white font-semibold gap-2 shadow-xs transition-all"
                onClick={handleCloneDashboard}
                disabled={isCloning}
              >
                <Copy className="h-4 w-4" />
                <span>{isCloning ? 'Cloning...' : 'Clone Dashboard'}</span>
              </Button>
            )}

            {/* Auto-Refresh Control */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  size="sm"
                  className={cn(
                    'bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-700/80 text-zinc-200 hover:text-white gap-1.5 text-xs font-medium h-9',
                    autoRefreshInterval > 0 &&
                      'border-emerald-500/50 text-emerald-400 bg-emerald-500/10'
                  )}
                  title={
                    autoRefreshInterval > 0
                      ? `Auto-refreshing every ${autoRefreshInterval}s (Next in ${refreshCountdown}s)`
                      : 'Set auto-refresh interval'
                  }
                >
                  <RefreshCw
                    className={cn(
                      'h-3.5 w-3.5',
                      autoRefreshInterval > 0 && 'animate-spin [animation-duration:3s]'
                    )}
                  />
                  <span>{autoRefreshInterval > 0 ? `${refreshCountdown}s` : 'Live'}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Auto-Refresh Interval
                </div>
                <DropdownMenuItem onClick={() => setAutoRefreshInterval(0)}>
                  <span>Off</span>
                  {autoRefreshInterval === 0 && <Check className="h-4 w-4 ml-auto text-primary" />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setAutoRefreshInterval(30)}>
                  <span>Every 30 seconds</span>
                  {autoRefreshInterval === 30 && (
                    <Check className="h-4 w-4 ml-auto text-primary" />
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setAutoRefreshInterval(60)}>
                  <span>Every 1 minute</span>
                  {autoRefreshInterval === 60 && (
                    <Check className="h-4 w-4 ml-auto text-primary" />
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setAutoRefreshInterval(300)}>
                  <span>Every 5 minutes</span>
                  {autoRefreshInterval === 300 && (
                    <Check className="h-4 w-4 ml-auto text-primary" />
                  )}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Presentation Mode */}
            <Button
              variant="secondary"
              size="icon"
              className={cn(
                'bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-700/80 text-zinc-200 hover:text-white h-9 w-9',
                isKioskMode && 'border-primary text-primary'
              )}
              onClick={toggleKioskMode}
              title={isKioskMode ? 'Exit Presentation Mode (Esc)' : 'Presentation Mode (Press F)'}
            >
              {isKioskMode ? <Minimize2 className="h-4 w-4" /> : <Tv className="h-4 w-4" />}
            </Button>

            {/* Export PDF Button */}
            <Button
              variant="secondary"
              size="sm"
              className="bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-700/80 text-zinc-200 hover:text-white gap-1.5 text-xs font-medium h-9"
              onClick={handleExportPdf}
              title="Print or Save as PDF"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Export PDF</span>
            </Button>

            {/* Share Button */}
            <Button
              variant="secondary"
              size="sm"
              className="bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-700/80 text-zinc-200 hover:text-white gap-1.5 text-xs font-medium h-9"
              onClick={() => setIsShareModalOpen(true)}
              title="Share dashboard link"
            >
              <Share2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Share</span>
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  size="icon"
                  aria-label="Dashboard settings"
                  className="bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-700/80 text-zinc-200 hover:text-white h-9 w-9"
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setIsEditing(!isEditing)}>
                  <LayoutDashboard className="h-4 w-4 mr-2" />
                  {isEditing ? 'Exit Edit Mode' : 'Edit Dashboard'}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={toggleKioskMode}>
                  <Tv className="h-4 w-4 mr-2" />
                  {isKioskMode ? 'Exit Presentation Mode' : 'Presentation Mode (F)'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleExportPdf}>
                  <Download className="h-4 w-4 mr-2" />
                  Export as PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setIsShareModalOpen(true)}>
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
      <div className="flex flex-wrap items-center gap-3 p-4 bg-card rounded-lg border print:hidden">
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

        {Boolean(currentFilters.teamId || currentFilters.serviceId || currentFilters.windowDays !== 7) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              const basePath = dashboardId ? `/reports/executive/${dashboardId}` : '/reports/executive';
              const params = new URLSearchParams();
              if (currentTemplateId && !dashboardId) params.set('template', currentTemplateId);
              const qs = params.toString();
              router.push(`${basePath}${qs ? `?${qs}` : ''}`);
            }}
            className="text-xs h-9 px-2.5 text-muted-foreground hover:text-foreground gap-1.5"
            title="Reset to default filters"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Reset</span>
          </Button>
        )}

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
