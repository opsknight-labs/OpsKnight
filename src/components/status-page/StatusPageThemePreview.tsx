'use client';

import { createPortal } from 'react-dom';
import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import { Monitor, Smartphone, Tablet } from 'lucide-react';
import StatusPageV3 from '@/components/status-page/StatusPageV3';
import { STATUS_PAGE_PUBLIC_CSS } from '@/lib/status-pages/public-css';
import type { PublicStatusPageSnapshot } from '@/lib/status-pages/public-contract';
import { computeStatusPageTheme } from '@/lib/status-page-theme';
import { toPreviewCustomCss } from '@/lib/status-page-content';
import {
  compileStatusPageThemeCss,
  resolveStatusPageTheme,
  resolveStatusPageThemeDensity,
  type StatusPageThemeDensity,
} from '@/lib/status-pages/theme-contract';
import { resolveStatusPageCustomCss } from '@/lib/status-pages/theme-custom-css';
import { cn } from '@/lib/utils';

type PreviewDevice = 'desktop' | 'tablet' | 'mobile';

const DEVICES: ReadonlyArray<{
  id: PreviewDevice;
  label: string;
  width: string;
  icon: typeof Monitor;
}> = [
  { id: 'desktop', label: 'Desktop', width: '100%', icon: Monitor },
  { id: 'tablet', label: 'Tablet', width: '820px', icon: Tablet },
  { id: 'mobile', label: 'Mobile', width: '390px', icon: Smartphone },
];

interface StatusPageThemePreviewProps {
  snapshot?: PublicStatusPageSnapshot | null;
  themeId: string;
  density: StatusPageThemeDensity;
  customCss: string;
}

/**
 * Actual V3 renderer used by the Appearance editor.
 *
 * The stylesheet order intentionally mirrors the public page:
 * shared V3 CSS -> curated built-in theme -> Advanced CSS.
 */
export default function StatusPageThemePreview({
  snapshot,
  themeId,
  density,
  customCss,
}: StatusPageThemePreviewProps) {
  const [device, setDevice] = useState<PreviewDevice>('desktop');
  const [previewRoot, setPreviewRoot] = useState<ShadowRoot | null>(null);

  const bindPreviewRoot = useCallback((host: HTMLDivElement | null) => {
    if (!host) return;
    setPreviewRoot(host.shadowRoot || host.attachShadow({ mode: 'open' }));
  }, []);

  const selectedTheme = resolveStatusPageTheme(themeId);
  const resolvedDensity = resolveStatusPageThemeDensity(density);
  const builtInThemeCss = useMemo(
    () => compileStatusPageThemeCss(selectedTheme.id, resolvedDensity),
    [selectedTheme.id, resolvedDensity]
  );
  const resolvedCustomCss = useMemo(
    () => toPreviewCustomCss(resolveStatusPageCustomCss(selectedTheme.id, customCss)),
    [selectedTheme.id, customCss]
  );

  const baseTheme = useMemo(() => {
    const branding = snapshot?.page?.branding ?? {};
    return computeStatusPageTheme({
      primaryColor:
        typeof branding.primaryColor === 'string' ? branding.primaryColor : null,
      backgroundColor:
        typeof branding.backgroundColor === 'string' ? branding.backgroundColor : null,
      textColor: typeof branding.textColor === 'string' ? branding.textColor : null,
      fontFamily: typeof branding.fontFamily === 'string' ? branding.fontFamily : null,
    });
  }, [snapshot]);

  const frameWidth = DEVICES.find(item => item.id === device)?.width ?? '100%';

  if (!snapshot) {
    return (
      <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        Live preview data is not available yet. Save or publish the status page once, then reopen
        Appearance to preview the curated theme against real services and incidents.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div>
          <div className="text-xs font-semibold text-foreground">Live V3 preview</div>
          <div className="text-[11px] text-muted-foreground">
            {selectedTheme.name} · {resolvedDensity}
          </div>
        </div>
        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1">
          {DEVICES.map(item => {
            const Icon = item.icon;
            const active = item.id === device;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setDevice(item.id)}
                aria-pressed={active}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors',
                  active
                    ? 'bg-background text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="max-h-[720px] overflow-auto bg-muted/20 p-3 sm:p-4">
        <div
          className="mx-auto overflow-hidden rounded-lg border border-border/70 bg-background shadow-sm transition-[width] duration-200"
          style={{ width: frameWidth, maxWidth: '100%', minHeight: '620px' }}
        >
          <div ref={bindPreviewRoot} style={{ minHeight: '620px', width: '100%' }} />
          {previewRoot &&
            createPortal(
              <>
                <style data-status-page-preview-baseline>{STATUS_PAGE_PUBLIC_CSS}</style>
                {builtInThemeCss && (
                  <style data-status-page-theme-preview>{builtInThemeCss}</style>
                )}
                {resolvedCustomCss && (
                  <style
                    data-status-page-custom-css-preview
                    dangerouslySetInnerHTML={{ __html: resolvedCustomCss }}
                  />
                )}
                <main
                  className="status-page-container"
                  data-sp-theme={selectedTheme.id}
                  data-sp-theme-version={selectedTheme.version}
                  data-sp-density={resolvedDensity}
                  style={{
                    minHeight: '620px',
                    background: `var(--sp-page-bg, ${baseTheme.backgroundColor})`,
                    color: `var(--sp-page-text, ${baseTheme.textColor})`,
                    fontFamily: baseTheme.fontFamily,
                    padding: 0,
                    ...(baseTheme.cssVariables as CSSProperties),
                    ['--status-content-width' as string]: '1280px',
                  }}
                >
                  <StatusPageV3
                    snapshot={snapshot}
                    styleMode="inherited"
                    subscribeEnabled={false}
                    refreshIntervalSeconds={null}
                  />
                </main>
              </>,
              previewRoot
            )}
        </div>
      </div>
    </div>
  );
}
