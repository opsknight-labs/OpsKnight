export type ResponderSessionPolicy = 'STANDARD' | 'TRUSTED_PWA';

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
