'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function RecoveryActivity() {
  const router = useRouter();
  useEffect(() => {
    let lastTouch = 0;
    const interact = (event: Event) => {
      if (
        !event.isTrusted ||
        Date.now() - lastTouch < 30000 ||
        document.visibilityState !== 'visible'
      )
        return;
      lastTouch = Date.now();
      void fetch('/api/auth/emergency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'activity' }),
      })
        .then(response => {
          if (!response.ok) router.replace('/login/emergency');
        })
        .catch(() => {});
    };
    for (const name of ['pointerdown', 'keydown']) document.addEventListener(name, interact);
    return () => {
      for (const name of ['pointerdown', 'keydown']) document.removeEventListener(name, interact);
    };
  }, [router]);
  return null;
}
