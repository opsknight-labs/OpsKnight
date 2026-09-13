import { describe, expect, it } from 'vitest';
import { resolveStatusPageCustomCss } from '@/lib/status-pages/theme-custom-css';

const LEGACY_LIGHT_TEMPLATE = `/* Template: Glacier */
.status-page-container { background: #f8fafc; }
.status-service-card { background: #ffffff !important; color: #0f172a !important; }
.status-v3-history { background: #ffffff !important; }`;

const MARKERLESS_LEGACY_TEMPLATE = `.status-page-container { background: #f8fafc !important; }
.status-page-header { background: #ffffff !important; }
.status-service-card { background: #ffffff !important; color: #0f172a !important; }
#incidents .status-incident-card { background: #ffffff !important; }`;

describe('status page curated theme custom CSS compatibility', () => {
  it('temporarily disables all Advanced CSS for curated dark themes during PR #650 diagnosis', () => {
    const genuineCustomCss = '.status-v3-service { outline: 2px solid hotpink; }';

    expect(resolveStatusPageCustomCss('command-center', genuineCustomCss)).toBe('');
    expect(resolveStatusPageCustomCss('terminal', genuineCustomCss)).toBe('');
    expect(resolveStatusPageCustomCss('arena-neon', genuineCustomCss)).toBe('');
    expect(resolveStatusPageCustomCss('global-operations', genuineCustomCss)).toBe('');
  });

  it('suppresses stale legacy template CSS for non-default curated light themes', () => {
    expect(resolveStatusPageCustomCss('executive', LEGACY_LIGHT_TEMPLATE)).toBe('');
    expect(resolveStatusPageCustomCss('executive', MARKERLESS_LEGACY_TEMPLATE)).toBe('');
  });

  it('preserves legacy template CSS under Default for backwards compatibility', () => {
    expect(resolveStatusPageCustomCss('default', LEGACY_LIGHT_TEMPLATE)).toBe(
      LEGACY_LIGHT_TEMPLATE
    );
    expect(resolveStatusPageCustomCss('default', MARKERLESS_LEGACY_TEMPLATE)).toBe(
      MARKERLESS_LEGACY_TEMPLATE
    );
  });

  it('keeps genuine customer Advanced CSS for curated light themes', () => {
    const customCss = '.status-v3-service { outline: 2px solid hotpink; }';

    expect(resolveStatusPageCustomCss('executive', customCss)).toBe(customCss);
  });

  it('fails safely for missing or invalid custom CSS', () => {
    expect(resolveStatusPageCustomCss('command-center', undefined)).toBe('');
    expect(resolveStatusPageCustomCss('command-center', null)).toBe('');
  });
});
