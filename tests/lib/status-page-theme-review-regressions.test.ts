import { describe, expect, it } from 'vitest';
import { projectPublicBranding } from '@/lib/status-pages/branding';
import { compileStatusPageThemeCss } from '@/lib/status-pages/theme-contract';

describe('status page theme review regressions', () => {
  it('preserves built-in theme metadata in the public branding projection', () => {
    expect(
      projectPublicBranding({
        themeId: 'enterprise-grid',
        themeVersion: 1,
        themeDensity: 'compact',
      })
    ).toEqual({
      themeId: 'enterprise-grid',
      themeVersion: 1,
      themeDensity: 'compact',
    });
  });

  it('targets the live V3 service list for card layouts', () => {
    const css = compileStatusPageThemeCss('enterprise-grid');

    expect(css).toContain('.status-v3-services__list');
    expect(css).toContain('grid-template-columns: repeat(auto-fit');
    expect(css).not.toContain('.status-services-grid');
  });

  it('targets the live V3 incident pill for compact and card layouts', () => {
    const compactCss = compileStatusPageThemeCss('executive');
    const cardCss = compileStatusPageThemeCss('enterprise-grid');

    expect(compactCss).toContain('.status-v3-incident-pill__summary');
    expect(cardCss).toContain('details.status-v3-incident-pill');
    expect(compactCss).not.toContain('.status-incident-card');
    expect(cardCss).not.toContain('.status-incident-card');
  });
});
