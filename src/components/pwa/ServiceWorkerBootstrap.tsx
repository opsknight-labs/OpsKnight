'use client';

import { useEffect } from 'react';
import { ensureHealthyServiceWorker } from '@/lib/service-worker-runtime';

/**
 * Single global authority for registering and reconciling the OpsKnight service worker.
 * Mounts once in the root layout, replacing next-pwa's automatic registration with
 * our serialized lifecycle manager.
 */
export default function ServiceWorkerBootstrap() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    // Run non-destructive inspection to discover or register the service worker
    // on initial load without disrupting any existing active clients.
    void ensureHealthyServiceWorker({
      purpose: 'inspection',
      activationPolicy: 'preserve-active-client',
    }).catch(() => {
      // Global background bootstrap swallows errors; individual features (Push,
      // Offline queue) will display appropriate user-facing state when engaged.
    });
  }, []);

  return null;
}
