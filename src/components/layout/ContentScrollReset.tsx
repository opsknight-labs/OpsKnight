'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

export default function ContentScrollReset() {
  const pathname = usePathname();

  useEffect(() => {
    // If there is an in-page hash anchor (e.g. #section-id), allow default scroll handling
    if (typeof window !== 'undefined' && window.location.hash) {
      return;
    }

    const contentShell = document.querySelector<HTMLElement>('.content-shell');
    if (contentShell) {
      contentShell.scrollTop = 0;
    }
  }, [pathname]);

  return null;
}
