'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { flushQueuedRequests } from '@/lib/offline-queue';
import { WifiOff, Wifi } from 'lucide-react';

type ConnectionInfo = {
  effectiveType?: string;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};

const isSlowConnection = (effectiveType: string | null) => {
  return effectiveType === 'slow-2g' || effectiveType === '2g';
};

export default function MobileNetworkBanner() {
  const router = useRouter();
  const [isOnline, setIsOnline] = useState(true);
  const [effectiveType, setEffectiveType] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateOnline = () => setIsOnline(navigator.onLine);
    const updateConnection = () => {
      const connection = (navigator as unknown as { connection?: ConnectionInfo }).connection;
      setEffectiveType(connection?.effectiveType ?? null);
    };

    updateOnline();
    updateConnection();
    if (navigator.onLine) {
      void flushQueuedRequests();
    }

    const handleOnline = () => {
      updateOnline();
      void flushQueuedRequests();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', updateOnline);

    const connection = (navigator as unknown as { connection?: ConnectionInfo }).connection;
    connection?.addEventListener?.('change', updateConnection);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', updateOnline);
      connection?.removeEventListener?.('change', updateConnection);
    };
  }, []);

  if (!isOnline) {
    return (
      <div
        className="mobile-network-banner offline animate-in slide-in-from-top-2 duration-300"
        data-swipe-ignore
      >
        <div className="flex items-center gap-2">
          <WifiOff className="h-4 w-4" />
          <span>You&apos;re offline. View-only mode.</span>
        </div>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="active:scale-95 transition-transform"
        >
          Retry
        </button>
      </div>
    );
  }

  if (isSlowConnection(effectiveType)) {
    return (
      <div
        className="mobile-network-banner slow animate-in slide-in-from-top-2 duration-300"
        data-swipe-ignore
      >
        <div className="flex items-center gap-2">
          <Wifi className="h-4 w-4" />
          <span>Slow connection. Updates may lag.</span>
        </div>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="active:scale-95 transition-transform"
        >
          Refresh
        </button>
      </div>
    );
  }

  return null;
}
