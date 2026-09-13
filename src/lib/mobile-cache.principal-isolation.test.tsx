import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MOBILE_CACHE_PREFIX, purgeMobileCacheStorage, readCache } from './mobile-cache';
import {
  MOBILE_PRINCIPAL_MARKER_ID,
  principalStorageSegment,
  type MobilePrincipalContext,
} from './mobile-principal';

function setPrincipal(context: MobilePrincipalContext) {
  let marker = document.getElementById(MOBILE_PRINCIPAL_MARKER_ID) as HTMLElement | null;
  if (!marker) {
    marker = document.createElement('div');
    marker.id = MOBILE_PRINCIPAL_MARKER_ID;
    document.body.appendChild(marker);
  }
  marker.dataset.principalId = context.principalId;
  marker.dataset.authGeneration = context.authGeneration;
}

function scopedKey(context: MobilePrincipalContext, key: string) {
  return `${MOBILE_CACHE_PREFIX}${principalStorageSegment(context)}:${key}`;
}

const userA = { principalId: 'user-a', authGeneration: '7' };
const userB = { principalId: 'user-b', authGeneration: '3' };

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('mobile responder cache principal isolation', () => {
  it('never reads User A cache after the authenticated principal switches to User B', async () => {
    setPrincipal(userA);
    const userAKey = scopedKey(userA, 'mobile-incidents');
    localStorage.setItem(
      userAKey,
      JSON.stringify({
        schemaVersion: 3,
        principalId: userA.principalId,
        authGeneration: userA.authGeneration,
        savedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        iv: 'not-needed-for-principal-isolation',
        ciphertext: 'user-a-secret-incident-data',
      })
    );

    setPrincipal(userB);
    await expect(readCache('mobile-incidents')).resolves.toBeNull();
    expect(localStorage.getItem(userAKey)).toContain('user-a-secret-incident-data');
  });

  it('rejects and destroys an envelope whose embedded principal does not match the active account', async () => {
    setPrincipal(userB);
    const userBKey = scopedKey(userB, 'mobile-incidents');
    localStorage.setItem(
      userBKey,
      JSON.stringify({
        schemaVersion: 3,
        principalId: userA.principalId,
        authGeneration: userA.authGeneration,
        savedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        iv: 'invalid',
        ciphertext: 'must-never-decrypt',
      })
    );

    await expect(readCache('mobile-incidents')).resolves.toBeNull();
    expect(localStorage.getItem(userBKey)).toBeNull();
  });

  it('purges all responder ciphertext during auth lifecycle cleanup', async () => {
    localStorage.setItem(scopedKey(userA, 'mobile-incidents'), 'ciphertext-a');
    localStorage.setItem(scopedKey(userB, 'mobile-notifications'), 'ciphertext-b');
    localStorage.setItem('unrelated-preference', 'keep-me');

    await purgeMobileCacheStorage();

    expect(localStorage.getItem(scopedKey(userA, 'mobile-incidents'))).toBeNull();
    expect(localStorage.getItem(scopedKey(userB, 'mobile-notifications'))).toBeNull();
    expect(localStorage.getItem('unrelated-preference')).toBe('keep-me');
  });
});
