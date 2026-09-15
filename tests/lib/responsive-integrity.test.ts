import { describe, it, expect } from 'vitest';
import { VIEWPORT_MATRIX, ALL_VIEWPORTS } from './responsive-viewport-matrix';

describe('responsive viewport matrix contract', () => {
  it('covers all required device profiles from 320px to 430px and landscape', () => {
    expect(VIEWPORT_MATRIX.verySmallPhone.width).toBe(320);
    expect(VIEWPORT_MATRIX.verySmallPhone.height).toBe(568);

    expect(VIEWPORT_MATRIX.compactAndroid.width).toBe(360);
    expect(VIEWPORT_MATRIX.compactAndroid.height).toBe(740);

    expect(VIEWPORT_MATRIX.iphoneCompact.width).toBe(375);
    expect(VIEWPORT_MATRIX.iphoneCompact.height).toBe(667);

    expect(VIEWPORT_MATRIX.modernIphone390.width).toBe(390);
    expect(VIEWPORT_MATRIX.modernIphone390.height).toBe(844);

    expect(VIEWPORT_MATRIX.modernIphone393.width).toBe(393);
    expect(VIEWPORT_MATRIX.modernIphone393.height).toBe(852);

    expect(VIEWPORT_MATRIX.mediumPhone.width).toBe(402);
    expect(VIEWPORT_MATRIX.mediumPhone.height).toBe(874);

    expect(VIEWPORT_MATRIX.largePhone.width).toBe(430);
    expect(VIEWPORT_MATRIX.largePhone.height).toBe(932);

    expect(VIEWPORT_MATRIX.phoneLandscape.width).toBe(844);
    expect(VIEWPORT_MATRIX.phoneLandscape.height).toBe(390);

    expect(VIEWPORT_MATRIX.smallLandscape.width).toBe(667);
    expect(VIEWPORT_MATRIX.smallLandscape.height).toBe(375);
  });

  it('provides all 9 explicit viewport profiles', () => {
    expect(ALL_VIEWPORTS).toHaveLength(9);
    const widths = ALL_VIEWPORTS.map(v => v.width);
    expect(widths).toContain(320);
    expect(widths).toContain(360);
    expect(widths).toContain(375);
    expect(widths).toContain(390);
    expect(widths).toContain(393);
    expect(widths).toContain(402);
    expect(widths).toContain(430);
  });
});
