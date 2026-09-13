import type { CSSProperties } from 'react';
import StatusPageAutoRefresh from './StatusPageAutoRefresh';
import StatusPageV3 from './StatusPageV3';
import type { StatusPageSnapshot } from '@/lib/status-pages/snapshot';
import { toSafeStyleTagContent } from '@/lib/status-page-content';
import { computeStatusPageTheme } from '@/lib/status-page-theme';
import { resolveStatusPageCustomCss } from '@/lib/status-pages/theme-custom-css';
import {
  resolveStatusPageTheme,
  resolveStatusPageThemeDensity,
} from '@/lib/status-pages/theme-contract';

/**
 * Published status-page shell.
 *
 * StatusPageV3 owns the shared base renderer and curated built-in theme layer. This shell only owns
 * page-level sizing/branding fallback, refresh behavior, and customer Advanced CSS, which remains
 * the final override layer after V3.
 */
export default function StatusPageSnapshotView({
  snapshot,
  stale,
}: {
  snapshot: StatusPageSnapshot;
  stale: boolean;
}) {
  const page = snapshot.page;
  const branding = page.branding ?? {};
  const themeBranding = branding as typeof branding & {
    themeId?: unknown;
    themeDensity?: unknown;
  };
  const presentation = page.presentation;
  const theme = computeStatusPageTheme({
    primaryColor: branding.primaryColor,
    backgroundColor: branding.backgroundColor,
    textColor: branding.textColor,
    fontFamily: branding.fontFamily,
  });
  const layout = presentation?.layout ?? branding.layout;
  const maxWidth = layout === 'wide' ? 1600 : layout === 'compact' ? 900 : 1280;
  const refreshInterval =
    presentation?.refreshInterval ??
    (typeof branding.refreshInterval === 'number' ? branding.refreshInterval : 60);
  const selectedTheme = resolveStatusPageTheme(themeBranding.themeId);
  const customCss = toSafeStyleTagContent(
    resolveStatusPageCustomCss(selectedTheme.id, branding.customCss)
  );
  const themeDensity = resolveStatusPageThemeDensity(themeBranding.themeDensity);
  const autoRefresh = presentation?.autoRefresh ?? branding.autoRefresh;

  return (
    <main
      className="status-page-container"
      data-sp-theme={selectedTheme.id}
      data-sp-theme-version={selectedTheme.version}
      data-sp-density={themeDensity}
      style={{
        minHeight: '100vh',
        // Curated themes define these variables from the shared V3 layer. Default defines nothing
        // and therefore falls back to the configured/native branding palette exactly as before.
        background: `var(--sp-page-bg, ${theme.backgroundColor})`,
        color: `var(--sp-page-text, ${theme.textColor})`,
        fontFamily: theme.fontFamily,
        padding: 0,
        ...(theme.cssVariables as CSSProperties),
        ['--status-content-width' as string]: `${maxWidth}px`,
      }}
    >
      {autoRefresh !== false && (
        <StatusPageAutoRefresh enabled intervalSeconds={Math.max(30, refreshInterval)} />
      )}
      <StatusPageV3
        snapshot={snapshot}
        stale={stale}
        refreshIntervalSeconds={autoRefresh !== false ? Math.max(30, refreshInterval) : null}
      />
      {customCss && (
        <style data-status-page-custom-css dangerouslySetInnerHTML={{ __html: customCss }} />
      )}
    </main>
  );
}
