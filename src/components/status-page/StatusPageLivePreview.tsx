'use client';

import { useState, useEffect, useRef, useMemo, useCallback, memo, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { logger } from '@/lib/logger';
import { toPreviewCustomCss } from '@/lib/status-page-content';
import { computeStatusPageTheme } from '@/lib/status-page-theme';
import { buildPreviewSnapshot } from '@/lib/status-pages/preview-snapshot';
import StatusPageV3 from '@/components/status-page/StatusPageV3';
import { STATUS_PAGE_PREVIEW_BASE_CSS } from '@/lib/status-page-preview-css';
import { cn } from '@/lib/utils';
import {
  Monitor,
  Tablet,
  Smartphone,
  ZoomIn,
  ZoomOut,
  Lock,
  ExternalLink,
  RotateCcw,
} from 'lucide-react';

export interface StatusPagePreviewService {
  id: string;
  name: string;
  status: string;
  region?: string | null;
  slaTier?: string | null;
  team?: {
    id: string;
    name: string;
  } | null;
  _count?: {
    incidents: number;
  };
  [key: string]: unknown;
}

export interface StatusPagePreviewStatusPageService {
  id: string;
  serviceId: string;
  displayName?: string | null;
  showOnPage: boolean;
  [key: string]: unknown;
}

export interface StatusPagePreviewAnnouncement {
  id: string;
  title: string;
  message: string;
  type?: string;
  severity?: string;
  startDate?: string;
  endDate?: string;
  services?: Array<{ id: string; name: string }>;
  [key: string]: unknown;
}

export interface StatusPagePreviewIncident {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  urgency?: string;
  createdAt: string | Date;
  acknowledgedAt?: string | Date | null;
  resolvedAt?: string | Date | null;
  service?: {
    id: string;
    name: string;
    region?: string | null;
  };
  events?: Array<{
    id: string;
    message: string;
    createdAt: string | Date;
  }>;
  postmortem?: {
    id: string;
    status: string;
    isPublic?: boolean | null;
  } | null;
  [key: string]: unknown;
}

export interface StatusPagePreviewPrivacySettings {
  showServiceMetrics?: boolean;
  showServiceDescriptions?: boolean;
  showServiceRegions?: boolean;
  showUptimeHistory?: boolean;
  showTeamInformation?: boolean;
  showIncidentTitles?: boolean;
  showIncidentDescriptions?: boolean;
  showAffectedServices?: boolean;
  showIncidentTimestamps?: boolean;
  showIncidentUrgency?: boolean;
  showIncidentDetails?: boolean;
  [key: string]: unknown;
}

export interface StatusPagePreviewData {
  statusPage: {
    name: string;
    slug?: string | null;
    subdomain?: string | null;
    customDomain?: string | null;
    contactEmail?: string | null;
    contactUrl?: string | null;
  };
  branding: Record<string, unknown>;
  services: StatusPagePreviewService[];
  statusPageServices: StatusPagePreviewStatusPageService[];
  announcements: StatusPagePreviewAnnouncement[];
  uptime90: Record<string, number>;
  incidents: StatusPagePreviewIncident[];
  showServices: boolean;
  showIncidents: boolean;
  showMetrics?: boolean;
  showSubscribe?: boolean;
  showServicesByRegion?: boolean;
  showServiceOwners?: boolean;
  showServiceSlaTier?: boolean;
  showChangelog?: boolean;
  showRegionHeatmap?: boolean;
  showPostIncidentReview?: boolean;
  showHeader: boolean;
  showFooter: boolean;
  footerText?: string | null;
  showRssLink: boolean;
  showApiLink: boolean;
  layout: string;
  privacySettings?: StatusPagePreviewPrivacySettings | null;
  enableUptimeExports?: boolean;
  regions?: any[];
  maintenance?: any[];
  uptimeExcellentThreshold?: number | null;
  uptimeGoodThreshold?: number | null;
}

export interface StatusPageLivePreviewProps {
  previewData: StatusPagePreviewData;
  maxWidth?: string;
  previewDomain?: string;
}

type DeviceView = 'mac' | 'ipad' | 'iphone';

const PREVIEW_DEVICES: Array<{
  id: DeviceView;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'mac', label: 'MacBook Pro', shortLabel: 'Desktop', icon: Monitor },
  { id: 'ipad', label: 'iPad Pro 12.9"', shortLabel: 'iPad', icon: Tablet },
  { id: 'iphone', label: 'iPhone 16 Pro', shortLabel: 'iPhone', icon: Smartphone },
];

function StatusPageLivePreview({
  previewData,
  maxWidth = '1280px',
  previewDomain,
}: StatusPageLivePreviewProps) {
  const [deviceView, setDeviceView] = useState<DeviceView>('mac');
  const [scale, setScale] = useState(1);
  const [zoomMode, setZoomMode] = useState<'fit' | 'manual'>('fit');
  const containerRef = useRef<HTMLDivElement>(null);
  const [previewRoot, setPreviewRoot] = useState<ShadowRoot | null>(null);

  const displayUrl = useMemo(() => {
    if (previewDomain && previewDomain.trim()) {
      return previewDomain.trim();
    }
    if (previewData.statusPage?.customDomain?.trim()) {
      return previewData.statusPage.customDomain.trim();
    }
    if (previewData.statusPage?.subdomain?.trim()) {
      return `${previewData.statusPage.subdomain.trim()}.opsknight.com`;
    }
    if (previewData.statusPage?.slug?.trim()) {
      return `status-${previewData.statusPage.slug.trim()}.opsknight.com`;
    }
    return 'status.opsknight.com';
  }, [previewDomain, previewData.statusPage]);

  const previewSnapshot = useMemo(
    () =>
      buildPreviewSnapshot({
        pageId: 'preview',
        name: previewData.statusPage?.name,
        slug: previewData.statusPage?.slug ?? undefined,
        subdomain: previewData.statusPage?.subdomain ?? undefined,
        customDomain: previewData.statusPage?.customDomain ?? undefined,
        contactEmail: previewData.statusPage?.contactEmail ?? null,
        contactUrl: previewData.statusPage?.contactUrl ?? null,
        branding: previewData.branding,
        presentation: {
          showHeader: previewData.showHeader,
          showFooter: previewData.showFooter,
          showRssLink: previewData.showRssLink,
          showApiLink: previewData.showApiLink,
        },
        services: previewData.services,
        mappings: previewData.statusPageServices,
        incidents: previewData.incidents,
        announcements: previewData.announcements,
        uptime90: previewData.uptime90,
        privacy: previewData.privacySettings ?? null,
        showServices: previewData.showServices,
        showIncidents: previewData.showIncidents,
        showSubscribe: previewData.showSubscribe,
        showChangelog: previewData.showChangelog,
        showServicesByRegion: previewData.showServicesByRegion,
        showRegionHeatmap: previewData.showRegionHeatmap,
        showPostIncidentReview: previewData.showPostIncidentReview,
        enableUptimeExports: previewData.enableUptimeExports,
        showServiceRegions: previewData.privacySettings?.showServiceRegions,
        showServiceOwners: previewData.showServiceOwners,
        showServiceSlaTier: previewData.showServiceSlaTier,
        showMetrics: previewData.showMetrics,
        showUptimeHistory: previewData.privacySettings?.showUptimeHistory,
        showTeamInformation: previewData.privacySettings?.showTeamInformation,
        regions: previewData.regions,
        maintenance: previewData.maintenance,
        thresholds: {
          uptimeExcellent:
            typeof previewData.uptimeExcellentThreshold === 'number'
              ? previewData.uptimeExcellentThreshold
              : 99.9,
          uptimeGood:
            typeof previewData.uptimeGoodThreshold === 'number'
              ? previewData.uptimeGoodThreshold
              : 99,
        },
      }),
    [previewData]
  );

  useEffect(() => {
    logger.debug('StatusPageLivePreview mounted/updated', {
      layout: previewData.layout,
      serviceCount: previewData.services.length,
      deviceView,
      zoomMode,
    });
  }, [previewData.layout, previewData.services.length, deviceView, zoomMode]);

  const contentMaxWidthStr =
    maxWidth ||
    (previewData.layout === 'wide'
      ? '1600px'
      : previewData.layout === 'compact'
        ? '900px'
        : '1280px');

  const contentMaxWidthNum = parseInt(contentMaxWidthStr.replace(/px$/, '')) || 1280;

  // Target device dimensions
  const targetWidth =
    deviceView === 'iphone'
      ? 393
      : deviceView === 'ipad'
        ? 820
        : Math.min(1280, contentMaxWidthNum);

  // Chrome & Status bar heights in unscaled CSS pixels
  const chromeTopHeight = deviceView === 'iphone' ? 50 : deviceView === 'ipad' ? 34 : 36;
  const chromeBottomHeight = deviceView === 'iphone' ? 68 : deviceView === 'ipad' ? 24 : 0;

  // Desktop vertical height: cut to standard balanced 700px
  const targetHeight = deviceView === 'iphone' ? 852 : deviceView === 'ipad' ? 1080 : 700;

  const viewportHeight = Math.max(200, targetHeight - chromeTopHeight - chromeBottomHeight);

  // Calculate scale to fit container dynamically without flickering
  useEffect(() => {
    if (!containerRef.current) return;

    const updateScale = () => {
      if (!containerRef.current) return;
      const containerWidth = containerRef.current.clientWidth;
      const containerHeight = containerRef.current.clientHeight;

      const paddingX = 32;
      const paddingY = 32;
      const availableWidth = Math.max(100, containerWidth - paddingX);
      const availableHeight = Math.max(100, containerHeight - paddingY);

      let newScale = availableWidth / targetWidth;
      const heightScale = availableHeight / targetHeight;
      newScale = Math.min(newScale, heightScale);
      newScale = Math.max(0.2, Math.min(newScale, 1));

      if (zoomMode === 'fit') {
        setScale(prev => (Math.abs(newScale - prev) > 0.005 ? newScale : prev));
      }
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, [zoomMode, targetWidth, targetHeight]);

  const handleZoom = (delta: number) => {
    setZoomMode('manual');
    setScale(prev => Math.min(Math.max(Number((prev + delta).toFixed(2)), 0.2), 1.5));
  };

  const contentMaxWidth = deviceView === 'mac' ? contentMaxWidthStr : '100%';

  const computedTheme = useMemo(() => {
    return computeStatusPageTheme({
      primaryColor:
        (typeof previewData.branding?.primaryColor === 'string' &&
          previewData.branding.primaryColor) ||
        (typeof previewData.branding?.primary === 'string' && previewData.branding.primary) ||
        null,
      backgroundColor:
        (typeof previewData.branding?.backgroundColor === 'string' &&
          previewData.branding.backgroundColor) ||
        (typeof previewData.branding?.background === 'string' && previewData.branding.background) ||
        null,
      textColor:
        (typeof previewData.branding?.textColor === 'string' && previewData.branding.textColor) ||
        (typeof previewData.branding?.text === 'string' && previewData.branding.text) ||
        null,
      fontFamily:
        typeof previewData.branding?.fontFamily === 'string'
          ? previewData.branding.fontFamily
          : null,
    });
  }, [
    previewData.branding?.primaryColor,
    previewData.branding?.primary,
    previewData.branding?.backgroundColor,
    previewData.branding?.background,
    previewData.branding?.textColor,
    previewData.branding?.text,
    previewData.branding?.fontFamily,
  ]);

  const bindPreviewRoot = useCallback((host: HTMLDivElement | null) => {
    if (host) setPreviewRoot(host.shadowRoot || host.attachShadow({ mode: 'open' }));
  }, []);

  const renderStatusPageContent = (contentMaxWidthValue: string) => (
    <main
      className="status-page-container"
      data-device-view={deviceView}
      style={{
        flex: 1,
        background: computedTheme.backgroundColor,
        color: computedTheme.textColor,
        fontFamily: computedTheme.fontFamily,
        padding: 0,
        minHeight: '100%',
        ...(computedTheme.cssVariables as CSSProperties),
        ['--status-content-width' as string]: contentMaxWidthValue,
      }}
    >
      <StatusPageV3 snapshot={previewSnapshot} styleMode="inherited" subscribeEnabled={true} />
    </main>
  );

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-background">
      {/* 1. Sleek Modern Preview Header Toolbar */}
      <div className="h-12 shrink-0 border-b border-border/80 bg-card px-3 flex items-center justify-between gap-2 select-none z-10 overflow-hidden">
        {/* Left: Live Status & Domain indicator */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            Live
          </span>
          <span
            className="hidden 2xl:inline-flex items-center gap-1 text-[11px] font-mono text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-md truncate max-w-[140px]"
            title={displayUrl}
          >
            <Lock className="w-2.5 h-2.5 text-muted-foreground/70 shrink-0" />
            <span className="truncate">{displayUrl}</span>
          </span>
        </div>

        {/* Center: Device Segmented Toggle */}
        <div className="inline-flex items-center p-0.5 rounded-lg bg-muted/70 border border-border/50 gap-0.5 shrink-0">
          {PREVIEW_DEVICES.map(device => {
            const isActive = deviceView === device.id;
            const Icon = device.icon;
            return (
              <button
                key={device.id}
                type="button"
                onClick={() => {
                  setDeviceView(device.id);
                  setZoomMode('fit');
                }}
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-all duration-150',
                  isActive
                    ? 'bg-background text-foreground shadow-xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                title={device.label}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{device.shortLabel}</span>
              </button>
            );
          })}
        </div>

        {/* Right: Zoom Controls & Open Tab Link */}
        <div className="flex items-center gap-1 shrink-0">
          <div className="inline-flex items-center rounded-lg bg-muted/60 border border-border/50 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => handleZoom(-0.1)}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-background/80 transition-colors"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoomMode(zoomMode === 'fit' ? 'manual' : 'fit')}
              className="px-1.5 py-0.5 text-[11px] font-semibold text-foreground hover:bg-background/80 rounded transition-colors min-w-[42px] text-center"
              title={zoomMode === 'fit' ? 'Switch to manual zoom' : 'Fit to screen'}
            >
              {zoomMode === 'fit' ? 'Fit' : `${Math.round(scale * 100)}%`}
            </button>
            <button
              type="button"
              onClick={() => handleZoom(0.1)}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-background/80 transition-colors"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          <a
            href={`/status/${encodeURIComponent(previewData.statusPage?.slug || '')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted border border-border/40 transition-colors"
            title="Open live status page in new tab"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* 2. Designer Canvas with Subtle Studio Dot Grid */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto p-4 select-none flex items-center justify-center"
        style={{
          background:
            'radial-gradient(circle, hsl(var(--muted-foreground) / 0.12) 1px, transparent 1px)',
          backgroundSize: '16px 16px',
          backgroundColor: 'hsl(var(--muted) / 0.35)',
        }}
      >
        {/* Device Frame Outer Chassis */}
        <div
          className="status-page-preview-device-frame"
          style={{
            width: `${Math.round(targetWidth * scale)}px`,
            minWidth: `${Math.round(targetWidth * scale)}px`,
            maxWidth: `${Math.round(targetWidth * scale)}px`,
            height: `${Math.round(targetHeight * scale)}px`,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            position: 'relative',
            borderRadius:
              deviceView === 'iphone'
                ? `${Math.round(52 * scale)}px`
                : deviceView === 'ipad'
                  ? `${Math.round(24 * scale)}px`
                  : '10px',
            border:
              deviceView === 'iphone'
                ? `${Math.round(10 * scale)}px solid #1c1d20`
                : deviceView === 'ipad'
                  ? `${Math.round(12 * scale)}px solid #1c1d20`
                  : '1px solid rgba(0, 0, 0, 0.18)',
            background: computedTheme.backgroundColor,
            boxShadow:
              deviceView === 'mac'
                ? '0 20px 40px -10px rgba(15, 23, 42, 0.28), 0 0 0 1px rgba(15, 23, 42, 0.08)'
                : deviceView === 'iphone'
                  ? '0 25px 60px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.12)'
                  : '0 20px 45px -10px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1)',
            boxSizing: 'border-box',
          }}
        >
          {/* Top Frame Chrome: Non-overlapping, status page begins strictly below */}
          {deviceView === 'mac' && (
            <div
              style={{
                height: `${Math.max(26, Math.round(chromeTopHeight * scale))}px`,
                background: 'linear-gradient(180deg, #ececec 0%, #dedede 100%)',
                borderBottom: '1px solid #c8c8c8',
                display: 'flex',
                alignItems: 'center',
                padding: '0 10px',
                gap: '8px',
                userSelect: 'none',
                flexShrink: 0,
              }}
            >
              {/* Traffic lights */}
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <span
                  style={{
                    width: '9px',
                    height: '9px',
                    borderRadius: '50%',
                    background: '#ff5f56',
                    border: '0.5px solid #e0443e',
                  }}
                />
                <span
                  style={{
                    width: '9px',
                    height: '9px',
                    borderRadius: '50%',
                    background: '#ffbd2e',
                    border: '0.5px solid #dea123',
                  }}
                />
                <span
                  style={{
                    width: '9px',
                    height: '9px',
                    borderRadius: '50%',
                    background: '#27c93f',
                    border: '0.5px solid #1aab29',
                  }}
                />
              </div>

              {/* Safari Address Bar */}
              <div
                style={{
                  flex: 1,
                  maxWidth: '360px',
                  margin: '0 auto',
                  height: '20px',
                  background: '#ffffff',
                  borderRadius: '5px',
                  border: '1px solid #c5c5c5',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  fontSize: '11px',
                  color: '#475569',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                  padding: '0 8px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                <Lock
                  style={{
                    width: '10px',
                    height: '10px',
                    color: '#10b981',
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontWeight: '500',
                  }}
                >
                  https://{displayUrl}
                </span>
              </div>
            </div>
          )}

          {deviceView === 'iphone' && (
            <div
              style={{
                height: `${Math.round(chromeTopHeight * scale)}px`,
                background: computedTheme.backgroundColor,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: `0 ${20 * scale}px`,
                position: 'relative',
                userSelect: 'none',
                flexShrink: 0,
                borderBottom: '1px solid rgba(0,0,0,0.05)',
              }}
            >
              {/* Clock */}
              <span
                style={{
                  fontSize: `${14 * scale}px`,
                  fontWeight: '600',
                  letterSpacing: '-0.02em',
                  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
                  color: computedTheme.textColor,
                  width: `${54 * scale}px`,
                }}
              >
                9:41
              </span>

              {/* Dynamic Island */}
              <div
                style={{
                  width: `${120 * scale}px`,
                  height: `${32 * scale}px`,
                  background: '#000000',
                  borderRadius: '999px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: `0 ${10 * scale}px`,
                  boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
                }}
              >
                <div
                  style={{
                    width: `${8 * scale}px`,
                    height: `${8 * scale}px`,
                    borderRadius: '50%',
                    background: '#1c1c1e',
                    border: '1px solid #2c2c2e',
                  }}
                />
                <div
                  style={{
                    width: `${6 * scale}px`,
                    height: `${6 * scale}px`,
                    borderRadius: '50%',
                    background: '#0a0a0a',
                  }}
                />
              </div>

              {/* Signal & Battery */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: `${5 * scale}px`,
                  color: computedTheme.textColor,
                  width: `${54 * scale}px`,
                  justifyContent: 'flex-end',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-end',
                    gap: `${1.5 * scale}px`,
                    height: `${10 * scale}px`,
                  }}
                >
                  <span
                    style={{
                      width: `${2 * scale}px`,
                      height: '35%',
                      background: 'currentColor',
                      borderRadius: '0.5px',
                    }}
                  />
                  <span
                    style={{
                      width: `${2 * scale}px`,
                      height: '55%',
                      background: 'currentColor',
                      borderRadius: '0.5px',
                    }}
                  />
                  <span
                    style={{
                      width: `${2 * scale}px`,
                      height: '75%',
                      background: 'currentColor',
                      borderRadius: '0.5px',
                    }}
                  />
                  <span
                    style={{
                      width: `${2 * scale}px`,
                      height: '100%',
                      background: 'currentColor',
                      borderRadius: '0.5px',
                    }}
                  />
                </div>
                <span
                  style={{
                    fontSize: `${10 * scale}px`,
                    fontWeight: '700',
                    letterSpacing: '-0.03em',
                  }}
                >
                  5G
                </span>
                <div
                  style={{
                    width: `${20 * scale}px`,
                    height: `${10 * scale}px`,
                    border: '1.2px solid currentColor',
                    borderRadius: `${3 * scale}px`,
                    padding: `${1 * scale}px`,
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: '85%',
                      background: 'currentColor',
                      borderRadius: `${1 * scale}px`,
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      right: `-${3.5 * scale}px`,
                      width: `${2 * scale}px`,
                      height: `${4 * scale}px`,
                      background: 'currentColor',
                      borderRadius: '0 1px 1px 0',
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {deviceView === 'ipad' && (
            <div
              style={{
                height: `${Math.round(chromeTopHeight * scale)}px`,
                background: computedTheme.backgroundColor,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: `0 ${20 * scale}px`,
                position: 'relative',
                userSelect: 'none',
                flexShrink: 0,
                borderBottom: '1px solid rgba(0,0,0,0.06)',
              }}
            >
              <span
                style={{
                  fontSize: `${12 * scale}px`,
                  fontWeight: '600',
                  color: computedTheme.textColor,
                }}
              >
                9:41 Tue Sep 12
              </span>
              <div
                style={{
                  width: `${8 * scale}px`,
                  height: `${8 * scale}px`,
                  borderRadius: '50%',
                  background: '#0a0a0a',
                  border: '1px solid #2a2a2a',
                }}
              />
              <div
                style={{
                  fontSize: `${11 * scale}px`,
                  fontWeight: '600',
                  color: computedTheme.textColor,
                }}
              >
                100%
              </div>
            </div>
          )}

          {/* Web Viewport: The real Status Page rendered strictly below top chrome */}
          <div
            style={{
              width: '100%',
              height: `${Math.round(viewportHeight * scale)}px`,
              position: 'relative',
              overflow: 'hidden',
              background: computedTheme.backgroundColor,
              flex: 1,
            }}
          >
            <div
              ref={bindPreviewRoot}
              className="status-page-container"
              data-device-view={deviceView}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: `${targetWidth}px`,
                minWidth: `${targetWidth}px`,
                maxWidth: `${targetWidth}px`,
                height: `${viewportHeight}px`,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                overflow: 'auto',
                boxSizing: 'border-box',
                containerType: 'inline-size',
                backgroundColor: computedTheme.backgroundColor,
                color: computedTheme.textColor,
                fontFamily: computedTheme.fontFamily,
                ...(computedTheme.cssVariables as React.CSSProperties),
              }}
            />
            {previewRoot &&
              createPortal(
                <>
                  <style data-status-page-preview-baseline>{STATUS_PAGE_PREVIEW_BASE_CSS}</style>
                  {previewData.branding?.customCss && (
                    <style
                      dangerouslySetInnerHTML={{
                        __html: toPreviewCustomCss(previewData.branding.customCss),
                      }}
                    />
                  )}
                  <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
                    {renderStatusPageContent(contentMaxWidth)}
                  </div>
                </>,
                previewRoot
              )}
          </div>

          {/* Bottom Bar for Mobile / Tablet */}
          {deviceView === 'iphone' && (
            <div
              style={{
                height: `${Math.round(chromeBottomHeight * scale)}px`,
                background: computedTheme.backgroundColor,
                borderTop: '1px solid rgba(0,0,0,0.06)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: `0 ${16 * scale}px`,
                gap: `${8 * scale}px`,
                userSelect: 'none',
                flexShrink: 0,
              }}
            >
              {/* Floating iOS Safari Address Pill */}
              <div
                style={{
                  width: '100%',
                  height: `${34 * scale}px`,
                  background: 'rgba(0, 0, 0, 0.05)',
                  borderRadius: '999px',
                  border: '1px solid rgba(0,0,0,0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: `0 ${14 * scale}px`,
                  fontSize: `${11 * scale}px`,
                  color: computedTheme.textColor,
                }}
              >
                <span style={{ fontSize: `${11 * scale}px`, fontWeight: '700', opacity: 0.6 }}>
                  aA
                </span>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: `${5 * scale}px`,
                    overflow: 'hidden',
                  }}
                >
                  <Lock
                    style={{
                      width: `${10 * scale}px`,
                      height: `${10 * scale}px`,
                      color: '#10b981',
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontWeight: '500',
                    }}
                  >
                    {displayUrl}
                  </span>
                </div>
                <RotateCcw
                  style={{ width: `${11 * scale}px`, height: `${11 * scale}px`, opacity: 0.6 }}
                />
              </div>

              {/* iOS Home Indicator */}
              <div
                style={{
                  width: `${125 * scale}px`,
                  height: `${4 * scale}px`,
                  background: computedTheme.textColor,
                  opacity: 0.35,
                  borderRadius: '999px',
                }}
              />
            </div>
          )}

          {deviceView === 'ipad' && (
            <div
              style={{
                height: `${Math.round(chromeBottomHeight * scale)}px`,
                background: computedTheme.backgroundColor,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                userSelect: 'none',
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: `${140 * scale}px`,
                  height: `${4 * scale}px`,
                  background: computedTheme.textColor,
                  opacity: 0.35,
                  borderRadius: '999px',
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(StatusPageLivePreview);
