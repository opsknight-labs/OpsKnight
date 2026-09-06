'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession, signOut } from 'next-auth/react';

interface SessionTimeoutWarningProps {
  /** Minutes before expiry to show warning (default: 5) */
  warningMinutes?: number;
  /** Callback when session is extended */
  onExtend?: () => void;
}

export default function SessionTimeoutWarning({
  warningMinutes = 5,
  onExtend,
}: SessionTimeoutWarningProps) {
  const { data: session, update } = useSession();
  const [showWarning, setShowWarning] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  const handleExtendSession = useCallback(async () => {
    try {
      // Trigger session update to refresh the JWT
      await update();
      setShowWarning(false);
      onExtend?.();
    } catch (error) {
      console.error('Failed to extend session:', error);
    }
  }, [update, onExtend]);

  const handleLogout = useCallback(async () => {
    await signOut({ callbackUrl: '/login' });
  }, []);

  useEffect(() => {
    if (!session?.expires) return;

    const checkExpiry = () => {
      const expiresAt = new Date(session.expires).getTime();
      const now = Date.now();
      const remaining = expiresAt - now;
      const warningThreshold = warningMinutes * 60 * 1000;

      if (remaining <= 0) {
        // Session expired, force logout
        signOut({ callbackUrl: '/login?error=SessionExpired' });
        return;
      }

      if (remaining <= warningThreshold && remaining > 0) {
        setShowWarning(true);
        setRemainingSeconds(Math.ceil(remaining / 1000));
      } else {
        setShowWarning(false);
      }
    };

    // Check immediately
    checkExpiry();

    // Check every second when warning is shown, otherwise every 30 seconds
    const interval = setInterval(checkExpiry, showWarning ? 1000 : 30000);

    return () => clearInterval(interval);
  }, [session?.expires, warningMinutes, showWarning]);

  // Update countdown
  useEffect(() => {
    if (!showWarning || remainingSeconds <= 0) return;

    const timer = setInterval(() => {
      setRemainingSeconds(prev => {
        if (prev <= 1) {
          signOut({ callbackUrl: '/login?error=SessionExpired' });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [showWarning, remainingSeconds]);

  if (!showWarning) return null;

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const timeDisplay = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />

      {/* Dialog */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="session-warning-title"
          aria-describedby="session-warning-description"
        >
          {/* Top accent */}
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-600 via-amber-500 to-amber-600" />

          <div className="p-6">
            {/* Icon */}
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
              <svg
                className="h-7 w-7 text-amber-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>

            {/* Content */}
            <div className="text-center">
              <h2 id="session-warning-title" className="text-xl font-semibold text-slate-900">
                Session Expiring Soon
              </h2>
              <p id="session-warning-description" className="mt-2 text-sm text-slate-500">
                Your session will expire in{' '}
                <span className="font-semibold text-amber-600">{timeDisplay}</span>. Would you like
                to stay signed in?
              </p>
            </div>

            {/* Actions */}
            <div className="mt-6 flex gap-3">
              <button
                onClick={handleLogout}
                className="flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Sign Out
              </button>
              <button
                onClick={handleExtendSession}
                className="flex-1 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
                autoFocus
              >
                Stay Signed In
              </button>
            </div>

            {/* Security note */}
            <p className="mt-4 text-center text-xs text-slate-400">
              For security, inactive sessions are automatically ended.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
