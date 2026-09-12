import type { NotificationChannel, NotificationCapacityMode } from '@prisma/client';

export type CapacitySource = 'DATABASE' | 'ENV' | 'DEFAULT';

export interface EffectiveCapacityConfig {
  channel: NotificationChannel;
  provider: string;
  mode: NotificationCapacityMode;
  // Distinguish what was persisted vs what the admission control actually enforces.
  configuredRatePerSecond: number;
  effectiveRatePerSecond: number;
  bulkRatePerSecond: number;
  maxInFlight: number;
  bulkMaxInFlight: number;
  quotaBlockSize: number;
  bulkShare: number;
  adaptiveBackpressure: boolean;
  source: CapacitySource;
  revision: number | null;
}

export interface CapacityLookupInput {
  channel: NotificationChannel;
  provider: string;
}
