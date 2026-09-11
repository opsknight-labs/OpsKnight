import type { CSSProperties } from 'react';
import StatusPageAutoRefresh from './StatusPageAutoRefresh';
import StatusPageV3 from './StatusPageV3';
import type { StatusPageSnapshot } from '@/lib/status-pages/snapshot';
import { toSafeStyleTagContent } from '@/lib/status-page-content';
import { computeStatusPageTheme } from '@/lib/status-page-theme';

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
  const autoRefresh = presentation?.autoRefresh ?? branding.autoRefresh;

  return (
    <main
      className="status-page-container"
      style={{
        minHeight: '100vh',
        background: theme.backgroundColor,
        color: theme.textColor,
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
      {customCss && <style dangerouslySetInnerHTML={{ __html: customCss }} />}
    </main>
  );
}
