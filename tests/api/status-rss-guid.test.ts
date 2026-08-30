import { describe, expect, it } from 'vitest';
import { opaqueRssIncidentGuid } from '@/app/api/status/rss/route';

describe('status RSS opaque incident GUIDs', () => {
  it('keeps hidden-identifier items unique and stable without exposing raw IDs', () => {
    const baseUrl = 'https://status.example.com';
    const first = opaqueRssIncidentGuid(baseUrl, 'status-page-1', 'incident-private-alpha');
    const second = opaqueRssIncidentGuid(baseUrl, 'status-page-1', 'incident-private-bravo');

    expect(first).toBe(opaqueRssIncidentGuid(baseUrl, 'status-page-1', 'incident-private-alpha'));
    expect(first).not.toBe(second);
    expect(first).not.toContain('incident-private-alpha');
    expect(second).not.toContain('incident-private-bravo');
  });
});
