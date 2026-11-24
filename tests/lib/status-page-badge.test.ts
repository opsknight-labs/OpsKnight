import { describe, expect, it } from 'vitest';
import { buildStatusBadge } from '@/lib/status-pages/badge';

describe('status badge', () => {
  it('names the status and uses its colour', () => {
    const svg = buildStatusBadge('Acme', 'MAJOR_OUTAGE');
    expect(svg).toContain('Acme: major outage');
    expect(svg).toContain('#be123c');
  });
  it('escapes the page name', () => {
    const svg = buildStatusBadge('<script>"x"&', 'OPERATIONAL');
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&#60;script&#62;');
  });
});
