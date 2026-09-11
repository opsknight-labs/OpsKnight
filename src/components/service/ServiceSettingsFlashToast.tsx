'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { notify } from '@/lib/toast';

/**
 * Flash → Toast bridge for server-action redirects that use `?saved=1` / `?error=...`.
 * - Success is centralized via the global Sonner toast (4s) with a stable id so rapid
 *   back-navigation or double-render does not stack duplicates.
 * - Validation-style errors (duplicate-service) toast once but keep the persistent
 *   inline notice rendered server-side — the toast is transient, the page banner is the source of truth.
 * - After surfacing, `saved` is stripped from the URL via replace so reload/replay does not re-toast.
 */
export default function ServiceSettingsFlashToast({ serviceId }: { serviceId: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const firedRef = useRef<string | null>(null);

  useEffect(() => {
    const saved = searchParams.get('saved');
    const err = searchParams.get('error');

    if (saved === '1' && firedRef.current !== 'saved') {
      firedRef.current = 'saved';
      notify.success('Service settings saved', { id: `service:${serviceId}:save` });
      const next = new URLSearchParams(searchParams.toString());
      next.delete('saved');
      const qs = next.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
      return;
    }

    if (err === 'duplicate-service' && firedRef.current !== 'duplicate-service') {
      firedRef.current = 'duplicate-service';
      notify.error('A service with this name already exists. Please choose a unique name.', {
        id: `service:${serviceId}:duplicate`,
      });
      // keep ?error in URL so the persistent inline alert stays visible; toast is additive
    }
  }, [searchParams, router, pathname, serviceId]);

  return null;
}
