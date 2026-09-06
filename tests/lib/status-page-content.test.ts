import { describe, expect, it } from 'vitest';
import { serializeJsonForHtml, toSafeStyleTagContent } from '@/lib/status-page-content';

describe('status-page HTML content helpers', () => {
  it('prevents CSS from terminating its style element', () => {
    const css = toSafeStyleTagContent('body { color: red; }</style><script>alert(1)</script>');

    expect(css).not.toContain('</style>');
    expect(css).not.toContain('<script>');
    expect(css).toContain('\\3C ');
  });

  it('serializes JSON-LD without HTML-significant characters', () => {
    const json = serializeJsonForHtml({ name: '</script><script>alert(1)</script>' });

    expect(json).not.toContain('<');
    expect(json).toContain('\\u003c/script\\u003e');
  });
});
