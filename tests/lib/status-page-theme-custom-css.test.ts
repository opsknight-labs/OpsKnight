import { describe, expect, it } from 'vitest';
import { resolveStatusPageCustomCss } from '@/lib/status-pages/theme-custom-css';

const LEGACY_LIGHT_TEMPLATE = `/* Template: Glacier */
.status-page-container { background: #f8fafc; }
.status-service-card { background: #ffffff !important; color: #0f172a !important; }
.status-v3-history { background: #ffffff !important; }`;

describe('status page curated theme custom CSS compatibility', () => {
  it('suppresses stale legacy template CSS across all themes including Default', () => {
    expect(resolveStatusPageCustomCss('command-center', LEGACY_LIGHT_TEMPLATE)).toBe('');
    expect(resolveStatusPageCustomCss('terminal', LEGACY_LIGHT_TEMPLATE)).toBe('');
    expect(resolveStatusPageCustomCss('executive', LEGACY_LIGHT_TEMPLATE)).toBe('');
    expect(resolveStatusPageCustomCss('default', LEGACY_LIGHT_TEMPLATE)).toBe('');
  });

  it('keeps genuine customer Advanced CSS as the final override for curated themes', () => {
    const customCss = '.status-service-card { outline: 2px solid hotpink; }';

    expect(resolveStatusPageCustomCss('command-center', customCss)).toBe(customCss);
  });

  it('fails safely for missing or invalid custom CSS', () => {
    expect(resolveStatusPageCustomCss('command-center', undefined)).toBe('');
    expect(resolveStatusPageCustomCss('command-center', null)).toBe('');
  });
});
