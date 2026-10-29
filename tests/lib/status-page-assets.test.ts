import { describe, expect, it } from 'vitest';
import { isValidStatusPageLogoBytes, parseStatusPageLogo } from '@/lib/status-pages/assets';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

describe('status-page logo validation', () => {
  it('accepts a bounded raster image with a matching declared format', () => {
    expect(parseStatusPageLogo(`data:image/png;base64,${png}`)).toMatchObject({
      mime: 'image/png',
    });
  });

  it('rejects MIME spoofing, malformed base64, truncated files and active SVG content', () => {
    expect(isValidStatusPageLogoBytes('image/jpeg', Buffer.from(png, 'base64'))).toBe(false);
    expect(parseStatusPageLogo(`data:image/jpeg;base64,${png}`)).toBeNull();
    expect(parseStatusPageLogo(`data:image/png;base64,${png}@@`)).toBeNull();
    expect(
      parseStatusPageLogo(
        `data:image/png;base64,${Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64')}`
      )
    ).toBeNull();
    expect(
      parseStatusPageLogo(
        `data:image/svg+xml;base64,${Buffer.from('<svg onload="alert(1)"/>').toString('base64')}`
      )
    ).toBeNull();
  });
});
