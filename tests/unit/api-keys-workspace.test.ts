import { describe, it, expect } from 'vitest';
import {
  WORKSPACE_TABS,
  normalizeWorkspaceTab,
} from '@/lib/api-keys-workspace';

describe('api-keys-workspace helper', () => {
  it('defines the 4 canonical workspace tab IDs', () => {
    expect(WORKSPACE_TABS).toEqual([
      'api-keys',
      'service-accounts',
      'explorer',
      'activity',
    ]);
  });

  it('normalizes valid tabs correctly', () => {
    expect(normalizeWorkspaceTab('api-keys')).toBe('api-keys');
    expect(normalizeWorkspaceTab('service-accounts')).toBe('service-accounts');
    expect(normalizeWorkspaceTab('explorer')).toBe('explorer');
    expect(normalizeWorkspaceTab('activity')).toBe('activity');
  });

  it('normalizes legacy api-explorer query param alias to explorer', () => {
    expect(normalizeWorkspaceTab('api-explorer')).toBe('explorer');
  });

  it('returns undefined for empty, null, undefined, or unrecognized tab values', () => {
    expect(normalizeWorkspaceTab(undefined)).toBeUndefined();
    expect(normalizeWorkspaceTab(null)).toBeUndefined();
    expect(normalizeWorkspaceTab('')).toBeUndefined();
    expect(normalizeWorkspaceTab('unknown-tab')).toBeUndefined();
    expect(normalizeWorkspaceTab('settings')).toBeUndefined();
  });
});
