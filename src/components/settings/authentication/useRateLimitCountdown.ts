'use client';

import { useState, useEffect } from 'react';

export function formatRemainingTime(seconds: number): string {
  if (seconds <= 0) return '0s';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) {
    return s > 0 ? `${m}m ${s}s` : `${m} minute${m === 1 ? '' : 's'}`;
  }
  return `${s} second${s === 1 ? '' : 's'}`;
}

export function parseCooldownSeconds(msg: string): number {
  if (!msg) return 0;
  const marker = 'Try again in ';
  const idx = msg.indexOf(marker);
  if (idx === -1) return 0;
  const text = msg.slice(idx + marker.length).trim();

  let minutes = 0;
  let seconds = 0;

  const parts = text.replaceAll('.', '').split(' ');
  let prevPart = '';
  for (const part of parts) {
    if (!part) continue;

    if (part.startsWith('minute')) {
      if (prevPart) {
        const val = Number.parseInt(prevPart, 10);
        if (!Number.isNaN(val)) minutes = val;
      }
    } else if (part.startsWith('second')) {
      if (prevPart) {
        const val = Number.parseInt(prevPart, 10);
        if (!Number.isNaN(val)) seconds = val;
      }
    } else if (part.endsWith('m') && !part.startsWith('min')) {
      const val = Number.parseInt(part.slice(0, -1), 10);
      if (!Number.isNaN(val)) minutes = val;
    } else if (part.endsWith('s') && !part.startsWith('sec')) {
      const val = Number.parseInt(part.slice(0, -1), 10);
      if (!Number.isNaN(val)) seconds = val;
    }
    prevPart = part;
  }

  return minutes * 60 + seconds;
}

/**
 * Parses cooldown strings like:
 * - "Too many authentication policy changes. Try again in 4m 30s."
 * - "Too many authentication operations. Try again in 45 seconds."
 * - "Too many requests. Try again in 5 minutes."
 * - "Too many authentication reads. Try again in 25s."
 *
 * Runs an interval to decrement the remaining time live every second,
 * and notifies when the cooldown has expired.
 */
export function useRateLimitCountdown(message: string): {
  displayMessage: string;
  isCooldown: boolean;
  remainingSeconds: number;
} {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const totalSeconds = parseCooldownSeconds(message);
    if (totalSeconds <= 0) {
      return;
    }

    const targetTime = Date.now() + totalSeconds * 1000;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((targetTime - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining <= 0) {
        setExpired(true);
        clearInterval(interval);
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      setSecondsLeft(0);
      setExpired(false);
    };
  }, [message]);

  if (!message) {
    return { displayMessage: '', isCooldown: false, remainingSeconds: 0 };
  }

  const initialCooldown = parseCooldownSeconds(message);
  if (initialCooldown > 0) {
    if (expired) {
      const updated = message.replace(
        /Try again in [^.]+/i,
        'Cooldown expired. You can try again now'
      );
      return { displayMessage: updated, isCooldown: false, remainingSeconds: 0 };
    }
    const currentSeconds = secondsLeft > 0 ? secondsLeft : initialCooldown;
    const timeFormatted = formatRemainingTime(currentSeconds);
    const updated = message.replace(/Try again in [^.]+/i, `Try again in ${timeFormatted}`);
    return { displayMessage: updated, isCooldown: true, remainingSeconds: currentSeconds };
  }

  return { displayMessage: message, isCooldown: false, remainingSeconds: 0 };
}
