// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ONCALL_FOR_SERVICE_COST,
  getMcpOncallForService,
  mcpCompositeCost,
} from '@/lib/mcp/core/composites';
import { principal, setupMcpReadDatabase } from '../helpers/mcp-read-scenarios';
import { createTestService } from '../helpers/test-db';

setupMcpReadDatabase();

const unique = () => randomUUID().slice(0, 8);
const fails = (promise: Promise<unknown>) =>
  promise.then(
    () => 'allowed',
    (error: Error) => error.message
  );

describe('oncall_for_service by name', () => {
  it('resolves an exact name, case-insensitively, without the assistant knowing the id', async () => {
    const caller = await principal('RESPONDER', ['services:read', 'schedules:read']);
    const service = await createTestService(`Billing ${unique()}`);
    const result = (await getMcpOncallForService(caller.ctx(), {
      serviceName: service.name.toUpperCase(),
    })) as { service: { id: string; name: string } | null };
    expect(result.service).toMatchObject({ id: service.id, name: service.name });
  });

  it('returns candidates instead of guessing when the name is ambiguous or not exact', async () => {
    const caller = await principal('RESPONDER', ['services:read', 'schedules:read']);
    const prefix = `Ledger ${unique()}`;
    const a = await createTestService(`${prefix} API`);
    const b = await createTestService(`${prefix} Worker`);
    const result = (await getMcpOncallForService(caller.ctx(), {
      serviceName: prefix,
    })) as { service: null; candidates: { id: string }[]; note: string };
    expect(result.service).toBeNull();
    expect(result.candidates.map(candidate => candidate.id).sort()).toEqual([a.id, b.id].sort());
    expect(result.note).toMatch(/serviceId/);
  });

  it('says so when exactly one service is close but not exact, and quotes the echoed name', async () => {
    const caller = await principal('RESPONDER', ['services:read', 'schedules:read']);
    const only = await createTestService(`Solo ${unique()} Worker`);
    const result = (await getMcpOncallForService(caller.ctx(), {
      serviceName: only.name.slice(0, only.name.length - 7),
    })) as { candidates: { id: string }[]; note: string };
    expect(result.candidates.map(candidate => candidate.id)).toEqual([only.id]);
    expect(result.note).toMatch(/One service is close but not an exact match/);
    expect(result.note).not.toMatch(/More than one/);
    const odd = (await getMcpOncallForService(caller.ctx(), {
      serviceName: `x"\ny ${unique()}`,
    })) as { note: string };
    // One quoted line: the quote and newline are escaped, not echoed raw.
    expect(odd.note).toContain('\\"');
    expect(odd.note).not.toContain('\n');
  });

  it('says so when nothing matches, and offers service_list', async () => {
    const caller = await principal('RESPONDER', ['services:read', 'schedules:read']);
    const result = (await getMcpOncallForService(caller.ctx(), {
      serviceName: `No such service ${unique()}`,
    })) as { candidates: unknown[]; note: string };
    expect(result.candidates).toEqual([]);
    expect(result.note).toContain('service_list');
  });

  it('needs exactly one of serviceId and serviceName', async () => {
    const caller = await principal('RESPONDER', ['services:read', 'schedules:read']);
    const service = await createTestService(`Either ${unique()}`);
    for (const input of [{}, { serviceId: service.id, serviceName: service.name }])
      expect(await fails(getMcpOncallForService(caller.ctx(), input))).toBe(
        'MCP_INVALID_ARGUMENTS'
      );
  });

  it('charges one more read when it has to look the name up', () => {
    expect(mcpCompositeCost('oncall_for_service', { serviceId: 'svc_1' })).toBe(
      ONCALL_FOR_SERVICE_COST
    );
    expect(mcpCompositeCost('oncall_for_service', { serviceName: 'payments' })).toBe(
      ONCALL_FOR_SERVICE_COST + 1
    );
  });
});
