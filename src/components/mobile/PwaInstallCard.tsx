'use client';

import { useState, useEffect } from 'react';
import { Download } from 'lucide-react';
import MobileSettingCard from '@/components/mobile/MobileSettingCard';
import { Button } from '@/components/ui/shadcn/button';

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

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function PwaInstallCard() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIos, setIsIos] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setIsIos(isIosSafari(window.navigator.userAgent));

    // Check if already standalone
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    setIsStandalone(standalone);

    // Listen for install prompt on Android/Desktop
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    await deferredPrompt.prompt();
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
    <MobileSettingCard
      icon={<Download className="h-5 w-5" aria-hidden="true" />}
      title="Install OpsKnight"
      status="Not installed"
      action={
        deferredPrompt ? (
          <Button type="button" size="sm" className="min-h-11" onClick={handleInstallClick}>
            Install
          </Button>
        ) : null
      }
    >
      <p className="text-xs leading-relaxed text-muted-foreground">
        Add the app to your Home Screen for faster access and alerts.
      </p>
      {!deferredPrompt ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Tap <span className="font-semibold text-foreground">Share</span>, scroll down, then tap{' '}
          <span className="font-semibold text-foreground">Add to Home Screen</span>.
        </p>
      ) : null}
    </MobileSettingCard>
  );
}
