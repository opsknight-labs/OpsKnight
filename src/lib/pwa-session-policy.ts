export type ResponderSessionPolicy = 'STANDARD' | 'TRUSTED_PWA';

const MIN_TRUSTED_PWA_DAYS = 30;
const MAX_TRUSTED_PWA_DAYS = 90;
const DEFAULT_TRUSTED_PWA_DAYS = 90;

export function resolveResponderSessionPolicy({
  displayModeStandalone,
  iosStandalone,
}: {
  displayModeStandalone: boolean;
  iosStandalone: boolean;
}): ResponderSessionPolicy {
  return displayModeStandalone || iosStandalone ? 'TRUSTED_PWA' : 'STANDARD';
}

/**
 * Installed PWAs are a responder-device context, not a mobile user-agent class.
 * This keeps session trust tied to an explicit installation/display mode and
 * avoids silently extending ordinary mobile-browser sessions.
 */
export function detectResponderSessionPolicy(): ResponderSessionPolicy {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'STANDARD';

  const displayModeStandalone =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  const iosStandalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

  return resolveResponderSessionPolicy({ displayModeStandalone, iosStandalone });
}

/**
 * Trusted responder-device sessions are intentionally bounded. Operators may
 * shorten or extend the window within the reviewed 30-90 day safety envelope;
 * malformed values fail back to the conservative documented default.
 */
export function getTrustedPwaSessionMaxAgeSeconds(): number {
  const parsed = Number.parseInt(process.env.TRUSTED_PWA_SESSION_DAYS ?? '', 10);
  const requestedDays = Number.isFinite(parsed) ? parsed : DEFAULT_TRUSTED_PWA_DAYS;
  const days = Math.min(MAX_TRUSTED_PWA_DAYS, Math.max(MIN_TRUSTED_PWA_DAYS, requestedDays));
  return days * 24 * 60 * 60;
}

export function getTrustedPwaSessionDays(): number {
  return Math.round(getTrustedPwaSessionMaxAgeSeconds() / (24 * 60 * 60));
}
