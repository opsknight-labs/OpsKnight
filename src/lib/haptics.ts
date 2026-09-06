'use client';

type VibrationPattern = number | number[];

const canVibrate = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (!('vibrate' in navigator)) return false;
  const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return !prefersReduced;
};

const vibrate = (pattern: VibrationPattern) => {
  if (!canVibrate()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Ignore haptics errors
  }
};

export const haptics = {
  tap: () => vibrate(8),
  soft: () => vibrate(5),
  selection: () => vibrate(10), // Sharp tick for tab selection
  impact: (style: 'light' | 'medium' | 'heavy' = 'light') => {
    switch (style) {
      case 'medium':
        return vibrate(15);
      case 'heavy':
        return vibrate(25);
      case 'light':
      default:
        return vibrate(10);
    }
  },
  success: () => vibrate([12, 20, 12]),
  warning: () => vibrate([20, 30, 20]),
  error: () => vibrate([30, 50, 30, 50]),
};

export const supportsHaptics = canVibrate;
