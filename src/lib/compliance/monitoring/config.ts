export interface ComplianceMonitoringConfig {
  readonly enabled: boolean;
  readonly intervalMinutes: number;
  readonly notificationsEnabled: boolean;
  readonly renotifyCooldownMinutes: number;
}

const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 1440; // 24 hours
const DEFAULT_INTERVAL_MINUTES = 60;

const MIN_COOLDOWN_MINUTES = 5;
const MAX_COOLDOWN_MINUTES = 1440;
const DEFAULT_COOLDOWN_MINUTES = 60;

function parseBoundedNumber(
  val: string | undefined,
  min: number,
  max: number,
  defaultVal: number
): number {
  if (!val) return defaultVal;
  const parsed = Number(val);
  if (Number.isNaN(parsed) || !Number.isFinite(parsed) || parsed < min || parsed > max) {
    return defaultVal;
  }
  return Math.floor(parsed);
}

export function getComplianceMonitoringConfig(): ComplianceMonitoringConfig {
  const enabled = process.env.COMPLIANCE_MONITORING_ENABLED !== 'false';
  const notificationsEnabled = process.env.COMPLIANCE_DRIFT_NOTIFICATIONS_ENABLED !== 'false';

  const intervalMinutes = parseBoundedNumber(
    process.env.COMPLIANCE_MONITOR_INTERVAL_MINUTES,
    MIN_INTERVAL_MINUTES,
    MAX_INTERVAL_MINUTES,
    DEFAULT_INTERVAL_MINUTES
  );

  const renotifyCooldownMinutes = parseBoundedNumber(
    process.env.COMPLIANCE_DRIFT_RENOTIFY_COOLDOWN_MINUTES,
    MIN_COOLDOWN_MINUTES,
    MAX_COOLDOWN_MINUTES,
    DEFAULT_COOLDOWN_MINUTES
  );

  return {
    enabled,
    intervalMinutes,
    notificationsEnabled,
    renotifyCooldownMinutes,
  };
}
