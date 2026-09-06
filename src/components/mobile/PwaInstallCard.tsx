'use client';

import React, { useState, useEffect } from 'react';
import MobileCard from '@/components/mobile/MobileCard';

function isIosSafari(userAgent: string) {
  const ua = userAgent.toLowerCase();
  const isIos = /iphone|ipad|ipod/.test(ua);
  const isSafari =
    ua.includes('safari') &&
    !ua.includes('crios') &&
    !ua.includes('fxios') &&
    !ua.includes('edgios');
  return isIos && isSafari;
}

export default function PwaInstallCard() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isIos, setIsIos] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    // Check if iOS Safari
    const ua = window.navigator.userAgent.toLowerCase();
    const ios =
      /iphone|ipad|ipod/.test(ua) &&
      ua.includes('safari') &&
      !ua.includes('crios') &&
      !ua.includes('fxios');
    setIsIos(ios);

    // Check if already standalone
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    setIsStandalone(standalone);

    // Listen for install prompt on Android/Desktop
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  if (!mounted || isStandalone) return null;

  // Show if we have an install prompt (Android/Desktop) OR if it's iOS Safari
  const shouldShow = !!deferredPrompt || isIos;

  if (!shouldShow) return null;

  return (
    <MobileCard padding="md" className="space-y-2">
      <div className="text-sm font-semibold text-[color:var(--text-primary)]">
        Install OpsKnight
      </div>
      <div className="text-xs text-[color:var(--text-muted)]">
        Add the app to your Home Screen for faster access and alerts.
      </div>

      {deferredPrompt ? (
        <button
          onClick={handleInstallClick}
          className="mt-1 inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary/90"
        >
          Install App
        </button>
      ) : (
        <div className="mt-1 text-xs text-[color:var(--text-muted)]">
          Tap <span className="font-semibold text-[color:var(--text-primary)]">Share</span>, scroll
          down, then tap{' '}
          <span className="font-semibold text-[color:var(--text-primary)]">Add to Home Screen</span>
          .
        </div>
      )}
    </MobileCard>
  );
}
