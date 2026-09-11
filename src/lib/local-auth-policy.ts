function enabled(value: string | undefined, fallback: boolean): boolean {
  return value == null ? fallback : value.trim().toLowerCase() === 'true';
}

function boundedSeconds(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export function getLocalAuthPolicy() {
  const localLoginEnabled = enabled(process.env.AUTH_LOCAL_LOGIN_ENABLED, true);
  const breakGlassEnabled = enabled(process.env.AUTH_BREAK_GLASS_ENABLED, false);
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
    maximumAgeSeconds: boundedSeconds(
      process.env.AUTH_SSO_SESSION_MAX_AGE_SECONDS,
      43_200,
      900,
      2_592_000
    ),
    updateAgeSeconds: boundedSeconds(
      process.env.AUTH_SSO_SESSION_UPDATE_AGE_SECONDS,
      3_600,
      60,
      86_400
    ),
    idleTimeoutSeconds: boundedSeconds(
      process.env.AUTH_SSO_SESSION_IDLE_TIMEOUT_SECONDS,
      14_400,
      300,
      604_800
    ),
    reauthenticateAfterSeconds: boundedSeconds(
      process.env.AUTH_SSO_REAUTH_AFTER_SECONDS,
      43_200,
      900,
      2_592_000
    ),
  };
}
