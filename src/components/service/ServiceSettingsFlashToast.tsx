'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { notify } from '@/lib/toast';

/**
 * Flash → Toast bridge for server-action redirects that use `?saved=1`.
 * - Success is centralized via the global Sonner toast (4s) with a stable id so rapid
 *   back-navigation or double-render does not stack duplicates.
 * - `?saved=1` is stripped via Next.js `router.replace(..., { scroll: false })` so
 *   reload/replay does not re-toast. Validation errors like `?error=duplicate-service`
 *   are intentionally NOT toasted — the persistent InlineNotice on the page already
 *   shows the recovery context; a transient duplicate toast would be noise.
 * - After surfacing, `saved` is stripped from the URL via replace so reload/replay does not re-toast.
 */
export default function ServiceSettingsFlashToast({ serviceId }: { serviceId: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const firedRef = useRef<string | null>(null);

  useEffect(() => {
    const saved = searchParams.get('saved');

    if (saved !== '1') {
      firedRef.current = null;
      return;
    }

    if (firedRef.current === 'saved') {
      return;
    }

    firedRef.current = 'saved';
    notify.success('Service settings saved', { id: `service:${serviceId}:save` });
    const next = new URLSearchParams(searchParams.toString());
    next.delete('saved');
    const qs = next.toString();
    // Next.js router.replace (not raw history.replaceState) so RSC cache stays coherent.
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
    // ?error=duplicate-service intentionally does NOT toast — the service page
    // renders a persistent InlineNotice with the same text and recovery guidance;
    // a transient duplicate toast would be noise.
  }, [searchParams, router, pathname, serviceId]);

  return null;
}
