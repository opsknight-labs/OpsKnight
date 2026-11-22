'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Re-renders the server page every `seconds` while the tab is visible, and right after it returns. */
export default function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const timer = window.setInterval(tick, seconds * 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [router, seconds]);
  return null;
}
