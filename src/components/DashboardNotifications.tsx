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
  enabled = true
}: DashboardNotificationsProps) {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [lastNotified, setLastNotified] = useState<{ critical: number; unassigned: number }>({ critical: 0, unassigned: 0 });

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    if ('Notification' in window) {
      setPermission(Notification.permission); // eslint-disable-line react-hooks/set-state-in-effect

      if (Notification.permission === 'default') {
        Notification.requestPermission().then(setPermission);
      }
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled || permission !== 'granted') return;

    // Notify on critical incidents
    if (criticalCount > 0 && criticalCount !== lastNotified.critical) {
      new Notification('Critical Incidents Detected', {
        body: `${criticalCount} high urgency incident${criticalCount !== 1 ? 's' : ''} require${criticalCount === 1 ? 's' : ''} immediate attention`,
        icon: '/favicon.ico',
        tag: 'critical-incidents',
        requireInteraction: false
      });
      setLastNotified(prev => ({ ...prev, critical: criticalCount })); // eslint-disable-line react-hooks/set-state-in-effect
    }

    // Notify on unassigned incidents
    if (unassignedCount > 0 && unassignedCount !== lastNotified.unassigned) {
      new Notification('Unassigned Incidents', {
        body: `${unassignedCount} incident${unassignedCount !== 1 ? 's' : ''} need${unassignedCount === 1 ? 's' : ''} assignment`,
        icon: '/favicon.ico',
        tag: 'unassigned-incidents',
        requireInteraction: false
      });
      setLastNotified(prev => ({ ...prev, unassigned: unassignedCount }));
    }
  }, [criticalCount, unassignedCount, permission, enabled, lastNotified]);

  if (!enabled || permission === 'denied') {
    return null;
  }

  return (
    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
      {permission === 'default' && (
        <span>🔔 Enable notifications for alerts</span>
      )}
      {permission === 'granted' && (criticalCount > 0 || unassignedCount > 0) && (
        <span>🔔 Notifications active</span>
      )}
    </div>
  );
}

