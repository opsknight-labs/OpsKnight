'use client';

import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';

const ACTIVITY_THROTTLE_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Records authentic user activity locally and flushes it on a coarse timer.
 * Pointer and keyboard events must never start session or database work in the
 * navigation critical path.
 */
export default function ActivityTracker() {
  const { data: session, update } = useSession();
  const hasUnsentActivityRef = useRef(false);

  useEffect(() => {
    // Only track activity when user has an active authenticated session
    if (!session?.user) return;

    const handleUserActivity = () => {
      hasUnsentActivityRef.current = true;
    };

    const flushActivity = () => {
      if (!hasUnsentActivityRef.current) return;

      hasUnsentActivityRef.current = false;
      void update({ activity: true }).catch(() => {
        hasUnsentActivityRef.current = true;
      });
    };

    const trackedEvents = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    trackedEvents.forEach(eventType => {
      window.addEventListener(eventType, handleUserActivity, { passive: true });
    });
    const heartbeat = window.setInterval(flushActivity, ACTIVITY_THROTTLE_MS);

    return () => {
      window.clearInterval(heartbeat);
      trackedEvents.forEach(eventType => {
        window.removeEventListener(eventType, handleUserActivity);
      });
    };
  }, [session?.user, update]);

  return null;
}
