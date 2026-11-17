import { describe, expect, it } from 'vitest';
import { getActiveNavHref, matchesRouteSegment } from '@/lib/navigation/active-nav';

const SHELL_HREFS = ['/', '/incidents', '/services', '/runbooks', '/status', '/settings'];

describe('matchesRouteSegment', () => {
  it('matches the route itself and nested routes by whole segment', () => {
    expect(matchesRouteSegment('/runbooks', '/runbooks')).toBe(true);
    expect(matchesRouteSegment('/runbooks/', '/runbooks')).toBe(true);
    expect(matchesRouteSegment('/runbooks/abc/compare', '/runbooks')).toBe(true);
    expect(matchesRouteSegment('/runbooks-foo', '/runbooks')).toBe(false);
    expect(matchesRouteSegment('/runbooksx/abc', '/runbooks')).toBe(false);
  });

  it('only matches home on the home route', () => {
    expect(matchesRouteSegment('/', '/')).toBe(true);
    expect(matchesRouteSegment('/incidents', '/')).toBe(false);
  });

  it('ignores query strings and hashes', () => {
    expect(matchesRouteSegment('/incidents?status=open', '/incidents')).toBe(true);
    expect(matchesRouteSegment('/incidents', '/incidents#top')).toBe(true);
  });
});

describe('getActiveNavHref', () => {
  it('highlights the closest matching item only', () => {
    expect(getActiveNavHref('/settings/integrations', SHELL_HREFS)).toBe('/settings');
    expect(getActiveNavHref('/incidents/templates', SHELL_HREFS)).toBe('/incidents');
    expect(
      getActiveNavHref('/incidents/templates/create', [...SHELL_HREFS, '/incidents/templates'])
    ).toBe('/incidents/templates');
  });

  it('returns null when nothing matches by segment', () => {
    expect(getActiveNavHref('/runbooks-foo', SHELL_HREFS)).toBeNull();
    expect(getActiveNavHref('/statuspage', SHELL_HREFS)).toBeNull();
  });

  it('returns home only for the root path', () => {
    expect(getActiveNavHref('/', SHELL_HREFS)).toBe('/');
    expect(getActiveNavHref('/services/abc/settings', SHELL_HREFS)).toBe('/services');
  });
});
