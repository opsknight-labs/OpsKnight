import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn() },
}));

import {
  getMetricsByIntegration,
  getMetricsByType,
  recordWebhookReceived,
  resetAllMetrics,
} from '@/lib/integrations/metrics';

describe('integration metrics key isolation', () => {
  beforeEach(() => resetAllMetrics());

  it('tracks prototype-like external identifiers as ordinary isolated keys', () => {
    recordWebhookReceived('__proto__', 'constructor', true, 12);
    recordWebhookReceived('constructor', '__proto__', false, 8);

    expect(getMetricsByType('__proto__').totalSuccess).toBe(1);
    expect(getMetricsByType('constructor').totalErrors).toBe(1);
    expect(getMetricsByIntegration('constructor').totalSuccess).toBe(1);
    expect(getMetricsByIntegration('__proto__').totalErrors).toBe(1);
  });
});
