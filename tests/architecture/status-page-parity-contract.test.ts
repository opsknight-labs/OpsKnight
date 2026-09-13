import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';

const read = (path: string) => readFileSync(path, 'utf8');

describe('status page preview/live parity contract', () => {
  it('renders the same component on both surfaces', () => {
    const live = read('src/components/status-page/StatusPageSnapshotView.tsx');
    const preview = read('src/components/status-page/StatusPageLivePreview.tsx');

    expect(live).toContain('StatusPageV3');
    expect(preview).toContain('StatusPageV3');
  });

  it('keeps a single services renderer', () => {
    const components = readdirSync('src/components/status-page');
    expect(components).toContain('v3');
    expect(read('src/components/status-page/v3/ServiceHealthV3.tsx')).toContain('ServiceHistoryV3');
    expect(read('src/components/status-page/v3/ServiceHistoryV3.tsx')).toContain(
      'status-v3-history'
    );
  });

  it('shares one stylesheet between the document and the preview shadow root', () => {
    const previewCss = read('src/lib/status-page-preview-css.ts');
    const page = read('src/components/status-page/StatusPageV3.tsx');

    expect(previewCss).toContain('STATUS_PAGE_PUBLIC_CSS');
    expect(page).toContain('STATUS_PAGE_PUBLIC_CSS');
  });

  it('applies custom CSS after the shared stylesheet on both surfaces', () => {
    const live = read('src/components/status-page/StatusPageSnapshotView.tsx');
    const preview = read('src/components/status-page/StatusPageLivePreview.tsx');
    const portal = preview.slice(preview.indexOf('data-status-page-preview-baseline'));

    expect(live).toContain('toSafeStyleTagContent');
    expect(preview).toContain('toPreviewCustomCss');
    expect(portal.indexOf('STATUS_PAGE_PREVIEW_BASE_CSS')).toBeLessThan(
      portal.indexOf('toPreviewCustomCss')
    );
  });

  it('keeps Tailwind utilities out of the public components', () => {
    const publicComponents = [
      'StatusPageV3',
      'StatusPageUptimeMetrics',
      'v3/ServiceHealthV3',
      'v3/ServiceHistoryV3',
    ];
    const utility =
      /className="[^"]*(?<![-\w])(?:mb-\d|mt-\d|p-\d|px-\d|py-\d|text-(?:sm|xs|lg|xl)|flex|grid|gap-\d|font-(?:bold|semibold)|w-full)(?![-\w])/;

    for (const name of publicComponents) {
      const source = read(`src/components/status-page/${name}.tsx`);
      expect(source, `${name} must not use Tailwind utilities`).not.toMatch(utility);
    }
  });

  it('derives no health severity in the presentation layer', () => {
    const page = read('src/components/status-page/StatusPageV3.tsx');
    expect(page).toContain('snapshot.services');
    expect(page).not.toContain('calculateServiceUptime');
    expect(page).not.toContain('publicStatusForIncidentUrgency');
    expect(page).not.toContain('createStatusPageViewModel');
  });
});
