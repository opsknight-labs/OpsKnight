import { beforeEach, describe, expect, it } from 'vitest';
import {
  getListReturnHref,
  getRememberedListQuery,
  isListReturnNavigation,
  isListReturnPath,
  rememberListUrl,
  type ListReturnStorage,
} from '@/lib/navigation/list-return';

function memoryStorage(): ListReturnStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: key => void data.delete(key),
  };
}

describe('list return', () => {
  let storage: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    storage = memoryStorage();
  });

  it('knows which routes are list pages', () => {
    expect(isListReturnPath('/incidents')).toBe(true);
    expect(isListReturnPath('/policies/')).toBe(true);
    expect(isListReturnPath('/incidents/abc')).toBe(false);
    expect(isListReturnPath('/settings')).toBe(false);
  });

  it('remembers a list query and restores it on a bare list href', () => {
    rememberListUrl('/incidents', '?status=OPEN&urgency=HIGH', storage);
    expect(getRememberedListQuery('/incidents', storage)).toBe('status=OPEN&urgency=HIGH');
    expect(getListReturnHref('/incidents', storage)).toBe('/incidents?status=OPEN&urgency=HIGH');
    expect(getListReturnHref('/incidents#top', storage)).toBe(
      '/incidents?status=OPEN&urgency=HIGH#top'
    );
  });

  it('keeps lists independent', () => {
    rememberListUrl('/services', 'q=api', storage);
    expect(getListReturnHref('/services', storage)).toBe('/services?q=api');
    expect(getListReturnHref('/teams', storage)).toBe('/teams');
  });

  it('clears the memory when the list is visited without a query', () => {
    rememberListUrl('/runbooks', '?tag=db', storage);
    rememberListUrl('/runbooks', '', storage);
    expect(getListReturnHref('/runbooks', storage)).toBe('/runbooks');
  });

  it('ignores non-list routes, explicit queries and oversized queries', () => {
    rememberListUrl('/settings', '?tab=x', storage);
    expect(storage.data.size).toBe(0);

    rememberListUrl('/users', '?role=ADMIN', storage);
    expect(getListReturnHref('/users?role=USER', storage)).toBe('/users?role=USER');
    expect(getListReturnHref('/users/abc', storage)).toBe('/users/abc');

    rememberListUrl('/users', `?q=${'x'.repeat(2100)}`, storage);
    expect(getListReturnHref('/users', storage)).toBe('/users');
  });

  it('survives unavailable or throwing storage', () => {
    const throwing: ListReturnStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => rememberListUrl('/incidents', '?a=1', throwing)).not.toThrow();
    expect(getListReturnHref('/incidents', throwing)).toBe('/incidents');
    expect(getListReturnHref('/incidents', null)).toBe('/incidents');
  });

  it('treats only up-navigation from a nested route to its own list as a list return', () => {
    expect(isListReturnNavigation('/incidents/abc', '/incidents')).toBe(true);
    expect(isListReturnNavigation('/services/abc/settings', '/services')).toBe(true);
    expect(isListReturnNavigation('/incidents', '/incidents')).toBe(false);
    expect(isListReturnNavigation('/incidents/abc', '/services')).toBe(false);
    expect(isListReturnNavigation('/incidents/abc', '/incidents?status=OPEN')).toBe(false);
    expect(isListReturnNavigation('/incidents-archive/abc', '/incidents')).toBe(false);
  });
});
