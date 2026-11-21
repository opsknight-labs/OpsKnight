// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { MCP_OPERATION_MAP, isMcpApprovalGated, isMcpExecutable } from '@/lib/mcp/catalog';
import { callMcpOperation } from '@/lib/mcp/core/execution';
import { GET as restRead } from '@/app/api/v2/service-objectives/[id]/alert-policy/route';
import { createTestService, testPrisma as db } from '../helpers/test-db';
import { principal } from '../helpers/mcp-read-scenarios';
import {
  describeApprovalScenarios,
  setupMcpApprovalDatabase,
  type Scenario,
} from '../helpers/mcp-approval-scenarios';

/**
 * MCP parity for SLO burn-rate alert policies: the policy read is the curated slo_alert_policy_get, burn
 * history is discoverable, and the policy write is approval-gated (it can page people) with no named tool.
 */

setupMcpApprovalDatabase();

type Envelope<T> = { data: { data: T } };

async function objectiveWithConnection() {
  const service = await createTestService(`SLO ${randomUUID().slice(0, 6)}`);
  const lineageId = `so_${randomUUID()}`;
  await db.serviceObjective.create({
    data: {
      id: lineageId,
      lineageId,
      serviceId: service.id,
      name: 'Checkout availability',
      metricType: 'AVAILABILITY',
      target: 99.9,
      comparator: 'GREATER_THAN_OR_EQUAL',
      windowType: 'THIRTY_DAYS',
    },
  });
  const connection = await db.observabilityConnection.create({
    data: {
      name: `prom-${randomUUID().slice(0, 6)}`,
      kind: 'PROMETHEUS',
      baseUrl: 'https://prom.example.com',
      enabled: true,
    },
  });
  return { serviceId: service.id, lineageId, connectionId: connection.id };
}

const body = (connectionId: string, enabled: boolean) => ({
  connectionId,
  goodQuery: 'sum(increase(http_requests_total{code!~"5.."}[5m]))',
  totalQuery: 'sum(increase(http_requests_total[5m]))',
  enabled,
});

describe('catalog review', () => {
  it('curates the policy read as slo_alert_policy_get', () => {
    const operation = MCP_OPERATION_MAP.get('getServiceObjectiveAlertPolicy')!;
    expect(operation).toMatchObject({
      status: 'CURATED',
      risk: 'R0',
      tool: 'slo_alert_policy_get',
      method: 'get',
      path: '/service-objectives/{id}/alert-policy',
    });
    expect(operation.requiredScopes).toEqual(['service-objectives:read']);
    expect(isMcpExecutable(operation)).toBe(true);
  });

  it('gates the policy write behind an approval, with no named tool', () => {
    const operation = MCP_OPERATION_MAP.get('updateServiceObjectiveAlertPolicy')!;
    expect(operation).toMatchObject({ status: 'APPROVAL_REQUIRED', risk: 'R2', tool: null });
    expect(operation.requiredScopes).toEqual(['service-objectives:write']);
    expect(operation.mutation).toMatchObject({ idempotency: 'required' });
    expect(isMcpApprovalGated(operation)).toBe(true);
    expect(isMcpExecutable(operation)).toBe(false);
  });

  it('exposes burn history as a discoverable read', () => {
    const operation = MCP_OPERATION_MAP.get('getServiceObjectiveBurnHistory')!;
    expect(operation).toMatchObject({ status: 'DISCOVERABLE', risk: 'R0', tool: null });
    expect(isMcpExecutable(operation)).toBe(true);
  });
});

describe('reads over MCP match REST', () => {
  it('returns the same policy as the REST route, and the same not-found', async () => {
    const s = await objectiveWithConnection();
    const reader = await principal('ADMIN', ['service-objectives:read']);
    const rest = async () =>
      restRead(
        new NextRequest(`http://localhost/api/v2/service-objectives/${s.lineageId}/alert-policy`, {
          headers: { authorization: `Bearer ${reader.restToken}` },
        }),
        { params: Promise.resolve({ id: s.lineageId }) }
      );
    expect((await rest()).status).toBe(404);
    await expect(
      callMcpOperation(reader.ctx(), 'getServiceObjectiveAlertPolicy', {
        path: { id: s.lineageId },
      })
    ).rejects.toThrow();

    await db.sloAlertPolicy.create({
      data: {
        lineageId: s.lineageId,
        serviceId: s.serviceId,
        ...body(s.connectionId, true),
      },
    });
    const viaMcp = (await callMcpOperation(reader.ctx(), 'getServiceObjectiveAlertPolicy', {
      path: { id: s.lineageId },
    })) as Envelope<Record<string, unknown>>;
    const viaRest = (await (await rest()).json()).data;
    expect(viaMcp.data.data).toEqual(viaRest);
    expect(viaMcp.data.data).toMatchObject({
      objectiveId: s.lineageId,
      state: 'OK',
      enabled: true,
    });

    const history = (await callMcpOperation(reader.ctx(), 'getServiceObjectiveBurnHistory', {
      path: { id: s.lineageId },
      query: { hours: 6 },
    })) as Envelope<{ objectiveId: string; hours: number; points: unknown[] }>;
    expect(history.data.data).toMatchObject({ objectiveId: s.lineageId, hours: 6, points: [] });
  });
});

const policyState = async (s: Record<string, string>) => {
  const row = await db.sloAlertPolicy.findUnique({ where: { lineageId: s.lineageId } });
  return row && [row.connectionId, row.enabled, row.goodQuery];
};

const scenarios: Scenario[] = [
  {
    name: 'set SLO burn alert policy',
    operationId: 'updateServiceObjectiveAlertPolicy',
    setup: async () => objectiveWithConnection(),
    input: async (_f, s) => ({
      args: { path: { id: s.lineageId }, body: body(s.connectionId, true) },
    }),
    effect: async (_f, s) => policyState(s),
  },
];

describeApprovalScenarios(scenarios);
