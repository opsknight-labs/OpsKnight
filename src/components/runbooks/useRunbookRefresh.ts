'use client';
import { useEffect } from 'react';
import type { useRouter } from 'next/navigation';
// Refresh server-authoritative props while inspecting; mutations also refresh through ActionForm.
export function useRunbookRefresh(router: ReturnType<typeof useRouter>, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => { if (document.visibilityState === 'visible') router.refresh(); };
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [enabled, router]);
}
