'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import StatusPageHeader from '@/components/status-page/StatusPageHeader';
import StatusPageServices from '@/components/status-page/StatusPageServices';
import StatusPageIncidents from '@/components/status-page/StatusPageIncidents';
import StatusPageAnnouncements from '@/components/status-page/StatusPageAnnouncements';
import { logger } from '@/lib/logger';
import { toSafeStyleTagContent } from '@/lib/status-page-content';
import { computeStatusPageTheme } from '@/lib/status-page-theme';

interface StatusPageLivePreviewProps {
  previewData: {
    statusPage: {
      name: string;
      contactEmail?: string | null;
      contactUrl?: string | null;
    };
    branding: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    services: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    statusPageServices: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    announcements: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    uptime90: Record<string, number>;
    incidents: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    showServices: boolean;
    showIncidents: boolean;
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
    privacySettings?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  maxWidth?: string;
}

type DeviceView = 'mac' | 'ipad' | 'iphone';

export default function StatusPageLivePreview({
  previewData,
  maxWidth = '1280px',
}: StatusPageLivePreviewProps) {
  const [deviceView, setDeviceView] = useState<DeviceView>('mac');
  const [scale, setScale] = useState(1);
  const [zoomMode, setZoomMode] = useState<'fit' | 'manual'>('fit');
  const containerRef = useRef<HTMLDivElement>(null);
  const [frameHeight, setFrameHeight] = useState('100%');

  // Calculate overall status based on services
  // Derived state - no need for effect
  const overallStatus = useMemo(() => {
    const hasOutage = previewData.services.some((s: any) => s.status === 'MAJOR_OUTAGE'); // eslint-disable-line @typescript-eslint/no-explicit-any
    const hasDegraded = previewData.services.some((s: any) => s.status === 'PARTIAL_OUTAGE'); // eslint-disable-line @typescript-eslint/no-explicit-any
    return hasOutage ? 'outage' : hasDegraded ? 'degraded' : 'operational';
  }, [previewData.services]);

  // Log mounting and prop changes for debugging
  useEffect(() => {
    logger.debug('StatusPageLivePreview mounted/updated', {
      layout: previewData.layout,
      serviceCount: previewData.services.length,
      incidentCount: previewData.incidents.length,
      deviceView,
      zoomMode,
    });
  }, [
    previewData.layout,
    previewData.services.length,
    previewData.incidents.length,
    deviceView,
    zoomMode,
  ]);

  // Use the maxWidth prop if provided, otherwise calculate from layout
  // Parse maxWidth to get numeric value for calculations
  const contentMaxWidthStr =
    maxWidth ||
    (previewData.layout === 'wide'
      ? '1600px'
      : previewData.layout === 'compact'
        ? '900px'
        : '1280px');

  // Extract numeric value from string like "1600px" or "900px"
  const contentMaxWidthNum = parseInt(contentMaxWidthStr.replace(/px$/, '')) || 1280;

  // Apple device frame dimensions
  const deviceDimensions: Record<
    DeviceView,
    { width: number; height: number | null; label: string }
  > = {
    mac: { width: Math.max(1440, contentMaxWidthNum), height: 900, label: 'MacBook Pro' },
    ipad: { width: 1024, height: 1366, label: 'iPad Pro 12.9"' },
    iphone: { width: 393, height: 852, label: 'iPhone 15 Pro' },
  };

  const targetWidth = deviceDimensions[deviceView].width;
  const targetHeight = deviceDimensions[deviceView].height;

  // Calculate scale based on container size
  useEffect(() => {
    if (!containerRef.current) return;

    const updateScale = () => {
      if (zoomMode === 'fit' && containerRef.current) {
        const containerWidth = containerRef.current.clientWidth;
        const containerHeight = containerRef.current.clientHeight;

        // Add some padding
        const availableWidth = containerWidth - 48;
        const availableHeight = containerHeight - 48;

        // Calculate width scale
        let newScale = availableWidth / targetWidth;

        // For mobile/tablet, also constrain by height to maintain aspect ratio within view
        if (targetHeight) {
          const heightScale = availableHeight / targetHeight;
          newScale = Math.min(newScale, heightScale);
        }

        // Don't scale up beyond 1.0 for "fit" mode, and ensure minimum scale
        newScale = Math.max(0.1, Math.min(newScale, 1));

        if (newScale !== scale) {
          setScale(newScale);
        }

        // Set frame height
        if (targetHeight) {
          setFrameHeight(`${targetHeight}px`);
        } else {
          const safeHeight = Math.max(containerHeight, 400);
          setFrameHeight(`${Math.ceil(safeHeight / newScale)}px`);
        }
      } else if (zoomMode === 'manual' && containerRef.current) {
        if (targetHeight) {
          setFrameHeight(`${targetHeight}px`);
        } else {
          const containerHeight = containerRef.current.clientHeight;
          const safeHeight = Math.max(containerHeight, 400);
          setFrameHeight(`${Math.ceil(safeHeight / scale)}px`);
        }
      }
    };

    // Update initial
    updateScale();

    const observer = new ResizeObserver(updateScale);
    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, [zoomMode, targetWidth, targetHeight, deviceView, scale]);

  const handleZoom = (delta: number) => {
    logger.debug('Zoom adjusted', { delta, currentScale: scale });
    setZoomMode('manual');
    setScale(prev => Math.min(Math.max(prev + delta, 0.25), 1.5)); // Limit zoom 0.25x to 1.5x
  };

  const deviceLabels: Record<DeviceView, string> = {
    mac: deviceDimensions.mac.label,
    ipad: deviceDimensions.ipad.label,
    iphone: deviceDimensions.iphone.label,
  };

  // For the inner content max-width (inside the scaled container)
  // Always use 100% for ipad and iphone, use contentMaxWidthStr for mac
  const contentMaxWidth = deviceView === 'mac' ? contentMaxWidthStr : '100%';
  const computedTheme = useMemo(() => {
    return computeStatusPageTheme({
      primaryColor: previewData.branding?.primaryColor || previewData.branding?.primary,
      backgroundColor: previewData.branding?.backgroundColor || previewData.branding?.background,
      textColor: previewData.branding?.textColor || previewData.branding?.text,
      fontFamily: previewData.branding?.fontFamily,
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
  const previewPrimaryColor = computedTheme.primaryColor;
  const previewTextColor = computedTheme.textColor;
  const frameHeightNumber = Number.parseFloat(frameHeight);
  const scaledFrameHeightStyle = Number.isFinite(frameHeightNumber)
    ? `${Math.round(frameHeightNumber * scale)}px`
    : 'auto';

  const renderStatusPageContent = (contentMaxWidthValue: string) => (
    <>
      {previewData.showHeader && (
        <StatusPageHeader
          statusPage={previewData.statusPage}
          overallStatus={overallStatus}
          branding={previewData.branding}
          lastUpdated={new Date().toISOString()}
        />
      )}
      <main
        style={{
          width: '100%',
          maxWidth: contentMaxWidthValue,
          margin: '0 auto',
          padding: previewData.layout === 'compact' ? '1.5rem' : '2rem',
          boxSizing: 'border-box',
          flex: 1,
        }}
      >
        {previewData.announcements.length > 0 && (
          <StatusPageAnnouncements
            announcements={previewData.announcements}
            showServiceRegions={previewData.privacySettings?.showServiceRegions !== false}
          />
        )}

        {previewData.showServices && previewData.services.length > 0 && (
          <StatusPageServices
            services={previewData.services}
            statusPageServices={previewData.statusPageServices}
            uptime90={previewData.uptime90}
            incidents={previewData.incidents}
            privacySettings={previewData.privacySettings}
            groupByRegionDefault={previewData.showServicesByRegion}
            showServiceOwners={previewData.showServiceOwners}
            showServiceSlaTier={previewData.showServiceSlaTier}
          />
        )}

        {previewData.showIncidents && (
          <StatusPageIncidents
            incidents={previewData.incidents}
            privacySettings={previewData.privacySettings}
          />
        )}

        {previewData.showSubscribe !== false && (
          <section style={{ marginBottom: 'clamp(2.5rem, 7vw, 5rem)' }}>
            <div
              style={{
                position: 'relative',
                overflow: 'hidden',
                borderRadius: '1rem',
                border: '1px solid var(--status-panel-border, #e5e7eb)',
                background: 'var(--status-panel-bg, #ffffff)',
                padding: 'clamp(1.5rem, 4vw, 2.5rem)',
                boxShadow: 'var(--status-card-shadow, 0 20px 45px rgba(15, 23, 42, 0.08))',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: '-60px',
                  right: '-60px',
                  width: '180px',
                  height: '180px',
                  background:
                    'radial-gradient(circle, color-mix(in srgb, var(--status-primary, #6366f1) 20%, transparent) 0%, transparent 70%)',
                  pointerEvents: 'none',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  bottom: '-80px',
                  left: '-80px',
                  width: '220px',
                  height: '220px',
                  background:
                    'radial-gradient(circle, color-mix(in srgb, var(--status-primary, #0ea5e9) 18%, transparent) 0%, transparent 70%)',
                  pointerEvents: 'none',
                }}
              />
              <div
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'clamp(1.5rem, 4vw, 2.5rem)',
                  flexWrap: 'wrap',
                }}
              >
                <div
                  style={{
                    flex: '1 1 260px',
                    minWidth: '240px',
                  }}
                >
                  <div
                    style={{
                      fontSize: '0.75rem',
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      color: previewPrimaryColor,
                      fontWeight: '700',
                      marginBottom: '0.5rem',
                    }}
                  >
                    Stay in the loop
                  </div>
                  <h2
                    style={{
                      fontSize: 'clamp(1.35rem, 3vw, 1.75rem)',
                      fontWeight: '700',
                      marginBottom: '0.75rem',
                      color: previewTextColor,
                    }}
                  >
                    Subscribe to Updates
                  </h2>
                  <p
                    style={{
                      fontSize: 'clamp(0.9rem, 2.2vw, 1rem)',
                      color: 'var(--status-text-muted, #4b5563)',
                      marginBottom: '1rem',
                      lineHeight: 1.6,
                    }}
                  >
                    Get incident alerts, maintenance notices, and recovery updates the moment they
                    happen.
                  </p>
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.35rem 0.75rem',
                      borderRadius: '999px',
                      background: 'var(--status-panel-bg, #ffffff)',
                      border: '1px solid var(--status-panel-border, #e5e7eb)',
                      color: 'var(--status-text, #374151)',
                      fontSize: '0.8125rem',
                      fontWeight: '600',
                    }}
                  >
                    Email notifications only
                  </div>
                </div>
                <div
                  style={{
                    flex: '1 1 320px',
                    minWidth: '280px',
                  }}
                >
                  <div
                    style={{
                      padding: 'clamp(1rem, 3vw, 1.5rem)',
                      background: 'var(--status-panel-bg, #ffffff)',
                      border: '1px solid var(--status-panel-border, #e5e7eb)',
                      borderRadius: '0.875rem',
                      boxShadow: 'var(--status-card-shadow, 0 12px 25px rgba(15, 23, 42, 0.12))',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 'var(--spacing-3)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem',
                      }}
                    >
                      <label
                        style={{
                          fontSize: 'var(--font-size-sm)',
                          fontWeight: '600',
                          color: previewTextColor,
                        }}
                      >
                        Subscribe to Updates
                      </label>
                      <input
                        type="email"
                        placeholder="your@email.com"
                        disabled
                        style={{
                          width: '100%',
                          padding: '0.65rem 0.75rem',
                          borderRadius: '0.5rem',
                          border: '1px solid var(--status-panel-border, #e5e7eb)',
                          background: 'var(--status-panel-muted-bg, #f9fafb)',
                          color: 'var(--status-text-subtle, #9ca3af)',
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      disabled
                      style={{
                        width: '100%',
                        padding: '0.65rem 0.75rem',
                        borderRadius: '0.5rem',
                        border: '1px solid var(--status-panel-border, #e5e7eb)',
                        background: 'var(--status-panel-muted-bg, #e5e7eb)',
                        color: 'var(--status-text-subtle, #9ca3af)',
                        fontWeight: '600',
                        cursor: 'not-allowed',
                      }}
                    >
                      Subscribe
                    </button>
                  </div>
                  <p
                    style={{
                      marginTop: '0.75rem',
                      fontSize: '0.8125rem',
                      color: 'var(--status-text-muted, #6b7280)',
                      textAlign: 'center',
                    }}
                  >
                    We&apos;ll never share your email. Unsubscribe anytime.
                  </p>
                </div>
              </div>
            </div>
          </section>
        )}

        {previewData.showFooter && (
          <footer
            style={{
              marginTop: '4rem',
              paddingTop: '2rem',
              borderTop: '1px solid #e5e7eb',
              textAlign: 'center',
              color: 'var(--status-text-muted, #6b7280)',
              fontSize: '0.875rem',
              paddingBottom: '2rem',
            }}
          >
            {previewData.footerText && (
              <p style={{ marginBottom: '1rem' }}>{previewData.footerText}</p>
            )}
            {(previewData.showRssLink || previewData.showApiLink) && (
              <div
                style={{ display: 'flex', justifyContent: 'center', gap: '1rem', flexWrap: 'wrap' }}
              >
                {previewData.showRssLink && (
                  <span style={{ color: 'var(--status-text-muted, #6b7280)' }}>RSS Feed</span>
                )}
                {previewData.showRssLink && previewData.showApiLink && <span>|</span>}
                {previewData.showApiLink && (
                  <span style={{ color: 'var(--status-text-muted, #6b7280)' }}>JSON API</span>
                )}
              </div>
            )}
          </footer>
        )}
      </main>
    </>
  );

  return (
    <>
      {/* Custom CSS */}
      {previewData.branding?.customCss && (
        <style
          dangerouslySetInnerHTML={{
            __html: toSafeStyleTagContent(previewData.branding.customCss),
          }}
        />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Device & Zoom Controls */}
        <div
          className="status-page-preview-controls"
          style={{
            padding: 'var(--status-preview-controls-padding, var(--spacing-3) var(--spacing-4))',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#ffffff',
            flexWrap: 'wrap',
            gap: 'var(--spacing-3)',
          }}
        >
          {/* Segmented control makes device toggles more scannable */}
          <div
            className="status-page-preview-device-toggle"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.2rem',
              padding: '0.2rem',
              borderRadius: '999px',
              border: '1px solid #cbd5e1',
              background: '#e2e8f0',
            }}
          >
            {(['mac', 'ipad', 'iphone'] as DeviceView[]).map(device => {
              const isActive = deviceView === device;
              const deviceIcons: Record<DeviceView, string> = {
                mac: '💻',
                ipad: '📱',
                iphone: '📲',
              };
              return (
                <button
                  key={device}
                  type="button"
                  onClick={() => {
                    setDeviceView(device);
                    setZoomMode('fit'); // Auto-fit on switch
                    logger.debug('Switched device view', { device });
                  }}
                  onMouseEnter={event => {
                    if (!isActive) {
                      event.currentTarget.style.background = 'rgba(255, 255, 255, 0.7)';
                    }
                  }}
                  onMouseLeave={event => {
                    if (!isActive) {
                      event.currentTarget.style.background = 'transparent';
                    }
                  }}
                  className={`status-page-preview-device-btn ${isActive ? 'is-active' : ''}`}
                  style={{
                    padding: 'var(--status-preview-device-padding, 0.45rem 0.95rem)',
                    background: isActive ? '#ffffff' : 'transparent',
                    border: '1px solid transparent',
                    borderRadius: '999px',
                    fontSize: 'var(--status-preview-device-font, var(--font-size-xs))',
                    fontWeight: isActive ? '700' : '600',
                    color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                    cursor: 'pointer',
                    transition: 'all 0.18s ease',
                    boxShadow: isActive ? '0 1px 2px rgba(15, 23, 42, 0.12)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                  }}
                  title={deviceLabels[device]}
                >
                  <span style={{ fontSize: '1rem' }}>{deviceIcons[device]}</span>
                  <span style={{ textTransform: 'capitalize' }}>
                    {device === 'mac' ? 'Mac' : device === 'ipad' ? 'iPad' : 'iPhone'}
                  </span>
                </button>
              );
            })}
          </div>

          <div
            className="status-page-preview-zoom"
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)' }}
          >
            <div
              className="status-page-preview-zoom-controls"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--spacing-1)',
                background: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--status-preview-zoom-padding, 2px)',
              }}
            >
              <button
                type="button"
                onClick={() => handleZoom(-0.1)}
                style={{
                  padding: 'var(--status-preview-zoom-button-padding, 4px 8px)',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  fontSize: 'var(--status-preview-zoom-font, 14px)',
                }}
                title="Zoom Out"
              >
                -
              </button>
              <button
                type="button"
                onClick={() => setZoomMode(zoomMode === 'fit' ? 'manual' : 'fit')}
                style={{
                  padding: 'var(--status-preview-zoom-button-padding, 4px 8px)',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: 'var(--status-preview-zoom-font, var(--font-size-xs))',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  minWidth: '60px',
                }}
                title={zoomMode === 'fit' ? 'Disable Fit to Screen' : 'Enable Fit to Screen'}
              >
                {zoomMode === 'fit' ? 'Fit' : `${Math.round(scale * 100)}%`}
              </button>
              <button
                type="button"
                onClick={() => handleZoom(0.1)}
                style={{
                  padding: 'var(--status-preview-zoom-button-padding, 4px 8px)',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  fontSize: 'var(--status-preview-zoom-font, 14px)',
                }}
                title="Zoom In"
              >
                +
              </button>
            </div>
          </div>
        </div>

        {/* Preview Container Wrapper */}
        <div
          ref={containerRef}
          className="status-page-preview-canvas"
          style={{
            flex: 1,
            overflow: 'auto',
            background: '#eef2f7',
            display: 'flex',
            position: 'relative',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--status-preview-padding, 24px)',
            minWidth: 0,
            minHeight: 300,
          }}
        >
          <div
            className="status-page-preview-device-frame"
            style={{
              width: `${Math.round(targetWidth * scale)}px`,
              minWidth: `${Math.round(targetWidth * scale)}px`,
              maxWidth: `${Math.round(targetWidth * scale)}px`,
              height: scaledFrameHeightStyle,
              overflow: 'hidden',
              borderRadius:
                deviceView === 'iphone'
                  ? `${44 * scale}px`
                  : deviceView === 'ipad'
                    ? '18px'
                    : '10px',
              border:
                deviceView === 'iphone'
                  ? `${8 * scale}px solid #1c1c1e`
                  : deviceView === 'ipad'
                    ? '10px solid #1c1c1e'
                    : '1px solid #c0c0c0',
              background: computedTheme.backgroundColor,
              boxShadow:
                deviceView === 'mac'
                  ? '0 25px 50px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.1)'
                  : '0 20px 40px rgba(0, 0, 0, 0.3), inset 0 0 0 1px rgba(255, 255, 255, 0.1)',
              boxSizing: 'border-box',
              position: 'relative',
            }}
          >
            {/* iPhone Dynamic Island */}
            {deviceView === 'iphone' && (
              <div
                style={{
                  position: 'absolute',
                  top: `${12 * scale}px`,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: `${126 * scale}px`,
                  height: `${37 * scale}px`,
                  background: '#000000',
                  borderRadius: `${20 * scale}px`,
                  zIndex: 10,
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
                }}
              />
            )}

            {/* Mac Safari Browser Chrome */}
            {deviceView === 'mac' && (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: `${36 * scale}px`,
                  background: 'linear-gradient(180deg, #e8e8e8 0%, #d4d4d4 100%)',
                  borderBottom: '1px solid #b0b0b0',
                  display: 'flex',
                  alignItems: 'center',
                  padding: `0 ${12 * scale}px`,
                  zIndex: 10,
                  borderRadius: `${10 * scale}px ${10 * scale}px 0 0`,
                }}
              >
                {/* Traffic lights */}
                <div style={{ display: 'flex', gap: `${6 * scale}px` }}>
                  <div
                    style={{
                      width: `${12 * scale}px`,
                      height: `${12 * scale}px`,
                      borderRadius: '50%',
                      background: '#ff5f57',
                      border: '0.5px solid #e0443e',
                    }}
                  />
                  <div
                    style={{
                      width: `${12 * scale}px`,
                      height: `${12 * scale}px`,
                      borderRadius: '50%',
                      background: '#febc2e',
                      border: '0.5px solid #d9a123',
                    }}
                  />
                  <div
                    style={{
                      width: `${12 * scale}px`,
                      height: `${12 * scale}px`,
                      borderRadius: '50%',
                      background: '#28c840',
                      border: '0.5px solid #1aab29',
                    }}
                  />
                </div>
                {/* Address bar */}
                <div
                  style={{
                    flex: 1,
                    margin: `0 ${40 * scale}px`,
                    height: `${22 * scale}px`,
                    background: '#ffffff',
                    borderRadius: `${6 * scale}px`,
                    border: '1px solid #c0c0c0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: `${11 * scale}px`,
                    color: '#666',
                  }}
                >
                  status.example.com
                </div>
              </div>
            )}

            {/* iPad Front Camera */}
            {deviceView === 'ipad' && (
              <>
                <div
                  style={{
                    position: 'absolute',
                    top: `${12 * scale}px`,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: `${10 * scale}px`,
                    height: `${10 * scale}px`,
                    background: 'radial-gradient(circle, #1a1a2e 0%, #0a0a0a 70%)',
                    borderRadius: '50%',
                    zIndex: 10,
                    boxShadow: 'inset 0 1px 2px rgba(255, 255, 255, 0.1)',
                  }}
                />
                {/* Home Indicator */}
                <div
                  style={{
                    position: 'absolute',
                    bottom: `${8 * scale}px`,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: `${140 * scale}px`,
                    height: `${5 * scale}px`,
                    background: 'rgba(0, 0, 0, 0.3)',
                    borderRadius: `${3 * scale}px`,
                    zIndex: 10,
                  }}
                />
              </>
            )}
            <div
              className="status-page-container"
              style={{
                width: `${targetWidth}px`,
                minWidth: `${targetWidth}px`,
                maxWidth: `${targetWidth}px`,
                height: frameHeight,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                overflow: 'auto',
                boxSizing: 'border-box',
                backgroundColor: computedTheme.backgroundColor,
                color: computedTheme.textColor,
                fontFamily: computedTheme.fontFamily,
                ...(computedTheme.cssVariables as React.CSSProperties),
              }}
            >
              <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
                {renderStatusPageContent(contentMaxWidth)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
