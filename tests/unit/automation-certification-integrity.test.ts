import { expect, it } from 'vitest';
import {
  controlledMeasurementEnvironment,
  FROZEN_CERTIFICATION,
  requireSuccessfulMeasurement,
  requireCleanProviderState,
} from '../load/helpers/automation-certification-integrity';

it('freezes every limit and separates fault-free comparison from recovery drills', () => {
  const env = controlledMeasurementEnvironment({ AUTOMATION_RECOVERY_DRILL: 'true' });
  expect(env.AUTOMATION_RECOVERY_DRILL).toBe('false');
  expect(env).toMatchObject(FROZEN_CERTIFICATION);
  for (const [key] of Object.entries(FROZEN_CERTIFICATION))
    expect(() => controlledMeasurementEnvironment({ [key]: 'relaxed' })).toThrow('requires');
});
it('rejects failed or abnormal child exits even when their artifacts look valid', () => {
  const report = {
    certificationStatus: 'MEASUREMENT_ONLY',
    results: [{ componentTimings: { complete: true }, telemetrySamples: [{}] }],
  };
  expect(() => requireSuccessfulMeasurement(1, report)).toThrow('exit');
  expect(() => requireSuccessfulMeasurement(null, report)).toThrow('exit');
  expect(() => requireSuccessfulMeasurement(0, report)).not.toThrow();
  expect(() => requireSuccessfulMeasurement(0, { ...report, results: [] })).toThrow('one');
  expect(() =>
    requireSuccessfulMeasurement(0, {
      ...report,
      results: [{ componentTimings: { complete: false }, telemetrySamples: [{}] }],
    })
  ).toThrow('telemetry');
  expect(() =>
    requireSuccessfulMeasurement(0, {
      ...report,
      results: [{ componentTimings: { complete: true }, telemetrySamples: [] }],
    })
  ).toThrow('telemetry');
});

it('requires default behavior, empty delivery state and every expected emulator provider', () => {
  const clean = {
    behavior: {
      mode: 'normal',
      latencyMs: 20,
      failureRate: 0,
      rateLimitPerSec: 0,
      retryAfterSec: 5,
    },
    inFlight: 0,
    totalRequests: 0,
    duplicateDeliveries: 0,
    uniqueDeliveriesSucceeded: 0,
  };
  const providers = Object.fromEntries(
    ['email', 'slack', 'sms', 'push', 'teams', 'webhook'].map(name => [name, clean])
  );
  expect(requireCleanProviderState(providers)).toHaveLength(6);
  expect(() => requireCleanProviderState({})).toThrow('clean');
  expect(() =>
    requireCleanProviderState({ ...providers, email: { ...clean, inFlight: 1 } })
  ).toThrow('clean');
  expect(() =>
    requireCleanProviderState({
      ...providers,
      email: { ...clean, behavior: { ...clean.behavior, mode: 'outage' } },
    })
  ).toThrow('clean');
  expect(() =>
    requireCleanProviderState({ ...providers, email: { ...clean, duplicateDeliveries: 1 } })
  ).toThrow('clean');
});
