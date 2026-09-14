'use client';

import { MOBILE_CACHE_PREFIX } from '@/lib/mobile-cache';
import { principalStorageSegment, readMobilePrincipalContext } from '@/lib/mobile-principal';

export type MobileCacheStatus = {
  savedAt: Date;
  expiresAt: Date;
};

function cacheStorageKey(key: string): string | null {
  const context = readMobilePrincipalContext();
  if (!context) return null;
  return `${MOBILE_CACHE_PREFIX}${principalStorageSegment(context)}:${key}`;
}

export function readMobileCacheStatus(key: string): MobileCacheStatus | null {
  if (typeof window === 'undefined') return null;
  const storageKey = cacheStorageKey(key);
  if (!storageKey) return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: unknown; expiresAt?: unknown };
    if (typeof parsed.savedAt !== 'string' || typeof parsed.expiresAt !== 'string') return null;
    const savedAt = new Date(parsed.savedAt);
    const expiresAt = new Date(parsed.expiresAt);
    if (!Number.isFinite(savedAt.getTime()) || !Number.isFinite(expiresAt.getTime())) return null;
    return { savedAt, expiresAt };
  } catch {
    return null;
  }
}

export function removeMobileCacheEntry(key: string): void {
  if (typeof window === 'undefined') return;
  const storageKey = cacheStorageKey(key);
  if (!storageKey) return;
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Draft/cache cleanup is best-effort; encrypted content expires by contract.
  }
}

export function formatCachedSnapshotTime(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  }).format(value);
}
