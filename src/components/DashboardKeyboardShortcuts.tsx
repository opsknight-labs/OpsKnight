'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCreateIncidentModal } from '@/contexts/IncidentCreationModalContext';
import KeyboardShortcuts from './KeyboardShortcuts';

type DashboardKeyboardShortcutsProps = {
  onRefresh?: () => void;
  onExport?: () => void;
};

export default function DashboardKeyboardShortcuts({
  onRefresh,
  onExport,
}: DashboardKeyboardShortcutsProps) {
  const router = useRouter();
  const { openCreateIncident } = useCreateIncidentModal();
  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input/textarea
      if (
        (e.target as HTMLElement).tagName === 'INPUT' ||
        (e.target as HTMLElement).tagName === 'TEXTAREA' ||
        (e.target as HTMLElement).isContentEditable
      ) {
        return;
      }

      // Show shortcuts modal
      if (e.key === '?' || ((e.metaKey || e.ctrlKey) && e.key === '/')) {
        e.preventDefault();
        setShowShortcuts(true);
      }

      // Refresh dashboard
      if (e.key === 'r' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onRefresh?.();
      }

      // Export CSV
      if (e.key === 'e' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onExport?.();
      }

      // New incident
      if (e.key === 'n' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        openCreateIncident();
      }

      // Quick navigation
      if (e.key === 'g') {
        let handleSecondKey: (e2: KeyboardEvent) => void;
        const timeout = setTimeout(() => {
          document.removeEventListener('keydown', handleSecondKey);
        }, 1000);

        handleSecondKey = (e2: KeyboardEvent) => {
          clearTimeout(timeout);
          document.removeEventListener('keydown', handleSecondKey);

          switch (e2.key.toLowerCase()) {
            case 'd':
              router.push('/');
              break;
            case 'i':
              router.push('/incidents');
              break;
            case 's':
              router.push('/services');
              break;
            case 't':
              router.push('/teams');
              break;
            case 'u':
              router.push('/users');
              break;
            case 'c':
              router.push('/schedules');
              break;
            case 'a':
              router.push('/analytics');
              break;
          }
        };

        document.addEventListener('keydown', handleSecondKey);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [router, onRefresh, onExport]);

  return (
    <>
      {showShortcuts && (
        <KeyboardShortcuts isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />
      )}
    </>
  );
}
