import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearRuntimeOperationalMetrics,
  runtimeOperationalMetrics,
  validateMetricDefinitions,
} from '@/lib/metrics/operational/registry';
import { V2_OPERATIONS } from '@/lib/api-v2/openapi-registry';
import { resolveOperationId, withV2Observability } from '@/lib/api-v2/observability';
import { apiV2Error } from '@/lib/api-v2/response';
import { AppError } from '@/lib/errors';

describe('REST v2 observability', () => {
  beforeEach(() => clearRuntimeOperationalMetrics());

  it('resolves every registered operation from a concrete URL', () => {
    for (const op of V2_OPERATIONS) {
      const concrete = `/api/v2${op.path.replace(/\{\w+\}/g, 'abc123')}`;
      expect(resolveOperationId(op.method, concrete), `${op.method} ${concrete}`).toBe(
        op.operationId
      );
    }
    expect(resolveOperationId('GET', '/api/v2/nope')).toBeNull();
  });

  it('counts requests per operation without exposing identifiers', async () => {
    const handler = withV2Observability(async () => new Response('ok', { status: 201 }));
    await handler(
      new NextRequest('http://x/api/v2/incidents/inc_secret_123/notes', { method: 'POST' })
    );

    const rows = runtimeOperationalMetrics().get('opsknight_http_requests_total') ?? [];
    expect(rows).toEqual([
      {
        labels: { method: 'POST', route: 'api_v2.addIncidentNote', status_class: '2xx' },
        value: 1,
      },
    ]);
    expect(JSON.stringify([...runtimeOperationalMetrics()])).not.toContain('inc_secret_123');
  });

  it('counts problem responses by category and keeps label cardinality bounded', () => {
    apiV2Error(new AppError({ code: 'API_KEY_INVALID' }), new NextRequest('http://x/api/v2/teams'));
    apiV2Error(
      new AppError({ code: 'RATE_LIMIT_EXCEEDED' }),
      new NextRequest('http://x/api/v2/teams')
    );
    const rows = runtimeOperationalMetrics().get('opsknight_api_v2_errors_total') ?? [];
    expect(rows.map(r => r.labels.category).sort()).toEqual(['authentication', 'rate_limit']);
    expect(() => validateMetricDefinitions()).not.toThrow();
  });
});
