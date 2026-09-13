'use client';

import { useEffect, useState } from 'react';

type DashboardNotificationsProps = {
  criticalCount: number;
  unassignedCount: number;
  enabled?: boolean;
};

export default function DashboardNotifications({
  criticalCount,
  unassignedCount,
  enabled = true,
}: DashboardNotificationsProps) {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [requestingPermission, setRequestingPermission] = useState(false);
  const [lastNotified, setLastNotified] = useState<{ critical: number; unassigned: number }>({
    critical: 0,
    unassigned: 0,
  });

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !('Notification' in window)) return;
    setPermission(Notification.permission); // eslint-disable-line react-hooks/set-state-in-effect
  }, [enabled]);

  useEffect(() => {
    if (!enabled || permission !== 'granted' || typeof document === 'undefined') return;
    // Avoid duplicating system push notifications while the dashboard is backgrounded.
    // These lightweight local notices are useful only while the user is actively in-app.
    if (document.visibilityState !== 'visible') return;

    if (criticalCount > 0 && criticalCount !== lastNotified.critical) {
      new Notification('Critical Incidents Detected', {
        body: `${criticalCount} high urgency incident${criticalCount !== 1 ? 's' : ''} require${criticalCount === 1 ? 's' : ''} immediate attention`,
        icon: '/favicon.ico',
        tag: 'critical-incidents',
        requireInteraction: false,
      });
      setLastNotified(prev => ({ ...prev, critical: criticalCount })); // eslint-disable-line react-hooks/set-state-in-effect
    }

    if (unassignedCount > 0 && unassignedCount !== lastNotified.unassigned) {
      new Notification('Unassigned Incidents', {
        body: `${unassignedCount} incident${unassignedCount !== 1 ? 's' : ''} need${unassignedCount === 1 ? 's' : ''} assignment`,
        icon: '/favicon.ico',
        tag: 'unassigned-incidents',
        requireInteraction: false,
      });
      setLastNotified(prev => ({ ...prev, unassigned: unassignedCount }));
    }
  }, [criticalCount, unassignedCount, permission, enabled, lastNotified]);

  if (!enabled || typeof window === 'undefined' || !('Notification' in window)) {
    return null;
  }

  const requestPermission = async () => {
    if (requestingPermission || Notification.permission !== 'default') return;
    setRequestingPermission(true);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
    } finally {
      setRequestingPermission(false);
    }
  };

  if (permission === 'denied') {
    return (
      <div className="mt-2 text-xs text-[color:var(--text-muted)]" role="status">
        Browser notifications are blocked. Enable them from your browser or site settings if you
        want in-app alert notices.
      </div>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-2 text-xs text-[color:var(--text-muted)]" aria-live="polite">
      {permission === 'default' && (
        <>
          <span>Enable browser notifications for incident alerts.</span>
          <button
            type="button"
            onClick={() => void requestPermission()}
            disabled={requestingPermission}
            className="min-h-11 rounded-lg border border-[color:var(--border)] px-3 font-semibold text-[color:var(--text-primary)] transition hover:bg-[color:var(--bg-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {requestingPermission ? 'Requesting…' : 'Enable'}
          </button>
        </>
      )}
      {permission === 'granted' && (criticalCount > 0 || unassignedCount > 0) && (
        <span>Notifications active</span>
      )}
    </div>
  );
}
