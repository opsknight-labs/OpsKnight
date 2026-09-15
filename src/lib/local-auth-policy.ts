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

export interface EnterpriseSessionPolicyOverrides {
  sessionMaxAgeSeconds?: number | null;
  sessionIdleTimeoutSeconds?: number | null;
}

export function getEnterpriseSessionPolicy(overrides?: EnterpriseSessionPolicyOverrides) {
  const envMaxAge = boundedSeconds(
    process.env.AUTH_SSO_SESSION_MAX_AGE_SECONDS,
    43_200,
    900,
    2_592_000
  );
  const envIdle = boundedSeconds(
    process.env.AUTH_SSO_SESSION_IDLE_TIMEOUT_SECONDS,
    14_400,
    300,
    604_800
  );

  const maximumAgeSeconds =
    typeof overrides?.sessionMaxAgeSeconds === 'number' &&
    Number.isFinite(overrides.sessionMaxAgeSeconds) &&
    overrides.sessionMaxAgeSeconds >= 900 &&
    overrides.sessionMaxAgeSeconds <= 2_592_000
      ? overrides.sessionMaxAgeSeconds
      : envMaxAge;

  let idleTimeoutSeconds =
    typeof overrides?.sessionIdleTimeoutSeconds === 'number' &&
    Number.isFinite(overrides.sessionIdleTimeoutSeconds) &&
    overrides.sessionIdleTimeoutSeconds >= 300 &&
    overrides.sessionIdleTimeoutSeconds <= 604_800
      ? overrides.sessionIdleTimeoutSeconds
      : envIdle;

  // Invariant: idle timeout cannot exceed maximum session age
  if (idleTimeoutSeconds > maximumAgeSeconds) {
    idleTimeoutSeconds = maximumAgeSeconds;
  }

  const envReauth = boundedSeconds(
    process.env.AUTH_SSO_REAUTH_AFTER_SECONDS,
    43_200,
    900,
    2_592_000
  );
  const reauthenticateAfterSeconds =
    typeof overrides?.sessionMaxAgeSeconds === 'number' &&
    Number.isFinite(overrides.sessionMaxAgeSeconds)
      ? maximumAgeSeconds
      : envReauth;

  return {
    maximumAgeSeconds,
    updateAgeSeconds: boundedSeconds(
      process.env.AUTH_SSO_SESSION_UPDATE_AGE_SECONDS,
      3_600,
      60,
      86_400
    ),
    idleTimeoutSeconds,
    reauthenticateAfterSeconds,
  };
}
