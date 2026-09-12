'use client';

import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';

const ACTIVITY_THROTTLE_MS = 2 * 60 * 1000; // 2 minutes

/**
 * ActivityTracker listens for authentic user interactions (clicks, keyboard,
 * touch, scroll) and sends a throttled update signal to the session endpoint.
 * This decouples enterprise idle timeout tracking from passive background polling.
 */
export default function ActivityTracker() {
  const { data: session, update } = useSession();
  const lastSignalRef = useRef<number>(0);

  useEffect(() => {
    // Only track activity when user has an active authenticated session
    if (!session?.user) return;

    const handleUserActivity = () => {
      const now = Date.now();
      if (lastSignalRef.current === 0 || now - lastSignalRef.current >= ACTIVITY_THROTTLE_MS) {
        lastSignalRef.current = now;
        void update({ activity: true }).catch(() => {
          // Ignore network errors on background activity pings
        });
      }
    };

    const trackedEvents = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    trackedEvents.forEach(eventType => {
      window.addEventListener(eventType, handleUserActivity, { passive: true });
    });

    return () => {
      trackedEvents.forEach(eventType => {
        window.removeEventListener(eventType, handleUserActivity);
      });
    };
  }, [session?.user, update]);

  return null;
}
