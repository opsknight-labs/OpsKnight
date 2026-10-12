export const FROZEN_CERTIFICATION = {
  AUTOMATION_RPS: '20',
  AUTOMATION_DURATION: '120s',
  AUTOMATION_MAX_LATENCY_RATIO: '1.25',
  AUTOMATION_MAX_QUEUE_AGE_MS: '30000',
  AUTOMATION_MAX_NOTIFICATION_P99_MS: '30000',
  AUTOMATION_DRAIN_TIMEOUT_MS: '180000',
  AUTOMATION_PROVIDER_CAPACITY_PROFILE: 'provisioned-200',
} as const;

export function controlledMeasurementEnvironment(env: Partial<NodeJS.ProcessEnv>) {
  for (const [key, value] of Object.entries(FROZEN_CERTIFICATION)) {
    if (env[key] !== undefined && env[key] !== value)
      throw new Error(`Controlled certification requires ${key}=${value}`);
  }
  return {
    ...process.env,
    ...env,
    ...FROZEN_CERTIFICATION,
    AUTOMATION_RECOVERY_DRILL: 'false',
    AUTOMATION_RESET_PROVIDER_TELEMETRY: 'true',
  };
}

export function requireSuccessfulMeasurement(
  exitCode: number | null,
  report: {
    certificationStatus: string;
    results: Array<{ componentTimings: { complete: boolean }; telemetrySamples: unknown[] }>;
  }
) {
  if (exitCode !== 0) throw new Error('Incomplete measurement: child did not exit successfully');
  if (report.certificationStatus !== 'MEASUREMENT_ONLY' || report.results.length !== 1)
    throw new Error('Incomplete measurement: expected one non-certifying report');
  const result = report.results[0];
  if (!result.componentTimings.complete || !result.telemetrySamples.length)
    throw new Error('Incomplete measurement: missing or partial telemetry');
}

export function requireSuccessfulRecovery(
  exitCode: number | null,
  report: {
    certificationStatus: string;
    results: unknown[];
    comparisonGate: { failures: string[] };
  }
) {
  if (exitCode !== 0) throw new Error('Recovery child did not exit successfully');
  if (
    report.certificationStatus !== 'RECOVERY_MEASUREMENT_ONLY' ||
    report.results.length !== 1 ||
    report.comparisonGate.failures.length
  )
    throw new Error('Recovery report incomplete or correctness gates failed');
}

export type InitialProvider = {
  behavior: {
    mode: string;
    latencyMs: number;
    failureRate: number;
    rateLimitPerSec: number;
    retryAfterSec: number;
    statusCodeOverride?: number;
    outageUntilEpochMs?: number;
  };
  inFlight: number;
  totalRequests: number;
  duplicateDeliveries: number;
  uniqueDeliveriesSucceeded: number;
};
export function requireCleanProviderState(providers: Record<string, InitialProvider>) {
  return ['email', 'slack', 'sms', 'push', 'teams', 'webhook'].map(name => {
    const provider = providers[name];
    if (
      !provider ||
      provider.inFlight !== 0 ||
      provider.totalRequests !== 0 ||
      provider.duplicateDeliveries !== 0 ||
      provider.uniqueDeliveriesSucceeded !== 0 ||
      provider.behavior.mode !== 'normal' ||
      provider.behavior.latencyMs !== 20 ||
      provider.behavior.failureRate !== 0 ||
      provider.behavior.rateLimitPerSec !== 0 ||
      provider.behavior.retryAfterSec !== 5 ||
      provider.behavior.statusCodeOverride !== undefined ||
      provider.behavior.outageUntilEpochMs !== undefined
    )
      throw new Error('Provider emulator did not restore its clean behavior/delivery state');
    return {
      name,
      behavior: provider.behavior,
      requests: provider.totalRequests,
      inFlight: provider.inFlight,
      duplicateDeliveries: provider.duplicateDeliveries,
    };
  });
}
