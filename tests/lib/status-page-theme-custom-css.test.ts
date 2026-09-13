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
  it('suppresses stale legacy template CSS when a curated dark theme is active', () => {
    expect(resolveStatusPageCustomCss('command-center', LEGACY_LIGHT_TEMPLATE)).toBe('');
    expect(resolveStatusPageCustomCss('terminal', LEGACY_LIGHT_TEMPLATE)).toBe('');
  });

  it('suppresses markerless legacy template payloads for curated themes', () => {
    expect(resolveStatusPageCustomCss('command-center', MARKERLESS_LEGACY_TEMPLATE)).toBe('');
    expect(resolveStatusPageCustomCss('terminal', MARKERLESS_LEGACY_TEMPLATE)).toBe('');
  });

  it('suppresses stale legacy template CSS for any non-default curated theme', () => {
    expect(resolveStatusPageCustomCss('executive', LEGACY_LIGHT_TEMPLATE)).toBe('');
  });

  it('preserves legacy template CSS under Default for backwards compatibility', () => {
    expect(resolveStatusPageCustomCss('default', LEGACY_LIGHT_TEMPLATE)).toBe(
      LEGACY_LIGHT_TEMPLATE
    );
    expect(resolveStatusPageCustomCss('default', MARKERLESS_LEGACY_TEMPLATE)).toBe(
      MARKERLESS_LEGACY_TEMPLATE
    );
  });

  it('keeps genuine customer Advanced CSS as the final override for curated themes', () => {
    const customCss = '.status-service-card { outline: 2px solid hotpink; }';
    const intentionalSurfaceOverride =
      '.status-service-card { background: #ffffff !important; border: 2px solid hotpink !important; }';

    expect(resolveStatusPageCustomCss('command-center', customCss)).toBe(customCss);
    expect(resolveStatusPageCustomCss('command-center', intentionalSurfaceOverride)).toBe(
      intentionalSurfaceOverride
    );
  });

  it('fails safely for missing or invalid custom CSS', () => {
    expect(resolveStatusPageCustomCss('command-center', undefined)).toBe('');
    expect(resolveStatusPageCustomCss('command-center', null)).toBe('');
  });
});
