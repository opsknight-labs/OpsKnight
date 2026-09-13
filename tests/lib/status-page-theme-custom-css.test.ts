import { describe, expect, it } from 'vitest';
import {
  isLegacyStatusPageCustomCss,
  resolveStatusPageCustomCss,
} from '@/lib/status-pages/theme-custom-css';

const LEGACY_LIGHT_TEMPLATE = `/* Template: Glacier */
.status-page-container { background: #f8fafc; }
.status-service-card { background: #ffffff !important; color: #0f172a !important; }
.status-v3-history { background: #ffffff !important; }`;

const MARKERLESS_LEGACY_TEMPLATE = `.status-page-container { background: #f8fafc !important; }
.status-page-header { background: #ffffff !important; }
.status-service-card { background: #ffffff !important; color: #0f172a !important; }
#incidents .status-incident-card { background: #ffffff !important; }`;

describe('status page curated theme custom CSS compatibility', () => {
  it('preserves genuine customer Advanced CSS for curated dark themes', () => {
    const customCss = '.status-v3-service { outline: 2px solid hotpink; }';

    expect(resolveStatusPageCustomCss('command-center', customCss)).toBe(customCss);
    expect(resolveStatusPageCustomCss('terminal', customCss)).toBe(customCss);
    expect(resolveStatusPageCustomCss('arena-neon', customCss)).toBe(customCss);
    expect(resolveStatusPageCustomCss('global-operations', customCss)).toBe(customCss);
  });

  it('suppresses stale legacy template CSS for every non-default curated theme', () => {
    expect(resolveStatusPageCustomCss('executive', LEGACY_LIGHT_TEMPLATE)).toBe('');
    expect(resolveStatusPageCustomCss('executive', MARKERLESS_LEGACY_TEMPLATE)).toBe('');
    expect(resolveStatusPageCustomCss('command-center', LEGACY_LIGHT_TEMPLATE)).toBe('');
    expect(resolveStatusPageCustomCss('command-center', MARKERLESS_LEGACY_TEMPLATE)).toBe('');
  });

  it('preserves legacy template CSS under Default for backwards compatibility', () => {
    expect(resolveStatusPageCustomCss('default', LEGACY_LIGHT_TEMPLATE)).toBe(
      LEGACY_LIGHT_TEMPLATE
    );
    expect(resolveStatusPageCustomCss('default', MARKERLESS_LEGACY_TEMPLATE)).toBe(
      MARKERLESS_LEGACY_TEMPLATE
    );
  });

  it('classifies legacy payloads without treating normal Advanced CSS as legacy', () => {
    expect(isLegacyStatusPageCustomCss(LEGACY_LIGHT_TEMPLATE)).toBe(true);
    expect(isLegacyStatusPageCustomCss(MARKERLESS_LEGACY_TEMPLATE)).toBe(true);
    expect(isLegacyStatusPageCustomCss('.status-v3-service { padding: 1rem; }')).toBe(false);
  });

  it('fails safely for missing or invalid custom CSS', () => {
    expect(resolveStatusPageCustomCss('command-center', undefined)).toBe('');
    expect(resolveStatusPageCustomCss('command-center', null)).toBe('');
    expect(isLegacyStatusPageCustomCss(undefined)).toBe(false);
  });
});
