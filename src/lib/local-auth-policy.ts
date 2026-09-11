function enabled(name: string, fallback: boolean): boolean {
  // eslint-disable-next-line security/detect-object-injection -- fixed internal environment keys only
  const value = process.env[name];
  return value == null ? fallback : value.trim().toLowerCase() === 'true';
}

function boundedSeconds(name: string, fallback: number, minimum: number, maximum: number): number {
  // eslint-disable-next-line security/detect-object-injection -- fixed internal environment keys only
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export function getLocalAuthPolicy() {
  const localLoginEnabled = enabled('AUTH_LOCAL_LOGIN_ENABLED', true);
  const breakGlassEnabled = enabled('AUTH_BREAK_GLASS_ENABLED', false);
  const breakGlassEmail = process.env.AUTH_BREAK_GLASS_EMAIL?.trim().toLowerCase() || null;
  return {
    enabled: localLoginEnabled || (breakGlassEnabled && Boolean(breakGlassEmail)),
    localLoginEnabled,
    breakGlassEnabled,
    breakGlassEmail,
  };
}

export function isLocalCredentialAllowed(email: string): boolean {
  const policy = getLocalAuthPolicy();
  return (
    policy.localLoginEnabled ||
    (policy.breakGlassEnabled && policy.breakGlassEmail === email.trim().toLowerCase())
  );
}

export function getEnterpriseSessionPolicy() {
  return {
    maximumAgeSeconds: boundedSeconds('AUTH_SSO_SESSION_MAX_AGE_SECONDS', 43_200, 900, 2_592_000),
    updateAgeSeconds: boundedSeconds('AUTH_SSO_SESSION_UPDATE_AGE_SECONDS', 3_600, 60, 86_400),
    idleTimeoutSeconds: boundedSeconds(
      'AUTH_SSO_SESSION_IDLE_TIMEOUT_SECONDS',
      14_400,
      300,
      604_800
    ),
    reauthenticateAfterSeconds: boundedSeconds(
      'AUTH_SSO_REAUTH_AFTER_SECONDS',
      43_200,
      900,
      2_592_000
    ),
  };
}
