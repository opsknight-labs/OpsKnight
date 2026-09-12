import type { CSSProperties } from 'react';
import StatusPageAutoRefresh from './StatusPageAutoRefresh';
import StatusPageV3 from './StatusPageV3';
import type { StatusPageSnapshot } from '@/lib/status-pages/snapshot';
import { toSafeStyleTagContent } from '@/lib/status-page-content';
import { computeStatusPageTheme } from '@/lib/status-page-theme';
import {
  compileStatusPageThemeCss,
  resolveStatusPageTheme,
  resolveStatusPageThemeDensity,
} from '@/lib/status-pages/theme-contract';

/**
 * Themed shell for the published status page.
 *
 * Visitor-facing chrome (theme, width, custom CSS, auto-refresh) lives here.
 * The page body is StatusPageV3, shared with the admin preview.
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
  const customCss = toSafeStyleTagContent(branding.customCss);
  const selectedTheme = resolveStatusPageTheme(themeBranding.themeId);
  const themeDensity = resolveStatusPageThemeDensity(themeBranding.themeDensity);
  const builtInThemeCss = compileStatusPageThemeCss(selectedTheme.id, themeDensity);
  const autoRefresh = presentation?.autoRefresh ?? branding.autoRefresh;

  return (
    <main
      className="status-page-container"
      data-sp-theme={selectedTheme.id}
      data-sp-theme-version={selectedTheme.version}
      data-sp-density={themeDensity}
      style={{
        minHeight: '100vh',
        // Built-in themes define these variables in their CSS layer. Default defines nothing and
        // therefore falls back to the configured/native branding palette exactly as before.
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
      {builtInThemeCss && <style data-status-page-theme>{builtInThemeCss}</style>}
      {customCss && (
        <style data-status-page-custom-css dangerouslySetInnerHTML={{ __html: customCss }} />
      )}
    </main>
  );
}
