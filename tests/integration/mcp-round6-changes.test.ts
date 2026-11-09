// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createRunbook } from '@/lib/runbooks/versioning';
import {
  SERVICE_CHANGES_COST,
  getMcpServiceChanges,
  mcpCompositeCost,
} from '@/lib/mcp/core/composites';
import { principal, setupMcpReadDatabase } from '../helpers/mcp-read-scenarios';
import { createTestIncident, createTestService, testPrisma as db } from '../helpers/test-db';

setupMcpReadDatabase();

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
type Changes = {
  service: { id: string; name: string | null } | null;
  window: { days: number };
  changes: {
    at: string;
    kind: string;
    source: string;
    summary: string;
    ref: { type: string; id: string };
    title?: string;
  }[];
  sources: Record<string, { status: string; count?: number; code?: string }>;
  note: string;
  truncated: boolean;
  candidates?: { id: string }[];
};
const scopes = ['services:read', 'incidents:read', 'runbooks:read', 'audit:read'];
const run = async (
  who: Awaited<ReturnType<typeof principal>>,
  input: Parameters<typeof getMcpServiceChanges>[1]
) => (await getMcpServiceChanges(who.ctx(), input)) as unknown as Changes;

describe('service_get_changes', () => {
  it('leaves message delivery receipts out of the configuration changes and says how many', async () => {
    // On a busy service every Teams or Slack message sent is audited against it; fifty of those
    // filled the whole page and hid the one real edit.
    const admin = await principal('ADMIN', scopes);
    const service = await createTestService(`Receipts ${Math.random().toString(36).slice(2, 8)}`);
    const now = Date.now();
    await db.auditLog.createMany({
      data: [
        {
          action: 'service.updated',
          entityType: 'SERVICE',
          entityId: service.id,
          createdAt: new Date(now - 3 * HOUR),
        },
        ...['microsoftTeams.delivery.completed', 'slack.delivery.completed'].flatMap(action =>
          [1, 2].map(minutes => ({
            action,
            entityType: 'SERVICE' as const,
            entityId: service.id,
            createdAt: new Date(now - minutes * 60_000),
          }))
        ),
      ],
    });
    const result = await run(admin, { serviceId: service.id });
    const summaries = result.changes.map(change => change.summary);
    expect(summaries).toEqual(['The service configuration was edited']);
    expect(JSON.stringify(result.changes)).not.toContain('delivery');
    expect(result.sources.configuration).toEqual({ status: 'ok', count: 1, receiptsLeftOut: 4 });
    expect(result.note).toMatch(/delivery receipts/i);
  });

  it('flags which source was cut short, so a full page is not mistaken for everything', async () => {
    const admin = await principal('ADMIN', scopes);
    const service = await createTestService(`Busy ${Math.random().toString(36).slice(2, 8)}`);
    const now = Date.now();
    for (let i = 0; i < 11; i += 1)
      await createTestIncident(`Busy incident ${i}`, service.id, {
        createdAt: new Date(now - (i + 1) * 60_000),
      });
    const busy = await run(admin, { serviceId: service.id });
    expect(busy.sources.incidents).toMatchObject({ status: 'ok', count: 10, truncated: true });
    expect(busy.sources.runbooks).toMatchObject({ truncated: true });

    const quiet = await createTestService(`Quiet ${Math.random().toString(36).slice(2, 8)}`);
    await createTestIncident('Quiet incident', quiet.id, { createdAt: new Date(now - 60_000) });
    const result = await run(admin, { serviceId: quiet.id });
    expect(result.sources.incidents).toEqual({ status: 'ok', count: 1 });
  });

  it('lists configuration edits, incidents and runbook runs newest first, each with its source', async () => {
    const admin = await principal('ADMIN', scopes);
    const service = await createTestService(`Changes ${Math.random().toString(36).slice(2, 8)}`);
    const now = Date.now();
    await db.auditLog.create({
      data: {
        action: 'service.updated',
        entityType: 'SERVICE',
        entityId: service.id,
        createdAt: new Date(now - 5 * HOUR),
      },
    });
    const incident = await createTestIncident('Checkout failing', service.id, {
      createdAt: new Date(now - 2 * HOUR),
    });
    const runbook = await createRunbook(
      {
        name: 'Restart checkout',
        slug: `restart-${Math.random().toString(36).slice(2, 8)}`,
        description: '',
      },
      admin.user.id
    );
    await db.runbookExecution.create({
      data: {
        runbookId: runbook.id,
        runbookVersionId: runbook.draftVersion.id,
        incidentId: incident.id,
        deadlineAt: new Date(now + 60_000),
        definitionChecksum: 'changes-checksum',
        inputValues: { secret: 'never-disclose' },
        executionPlan: { internal: 'never-disclose' },
        startedAt: new Date(now - HOUR),
      },
    });

    const result = await run(admin, { serviceId: service.id });
    expect(result.service).toMatchObject({ id: service.id });
    expect(result.changes.map(item => item.kind)).toEqual([
      'AUTOMATION',
      'INCIDENT',
      'CONFIGURATION',
    ]);
    expect(result.changes.map(item => item.source)).toEqual([
      'RUNBOOK_EXECUTION',
      'INCIDENT',
      'AUDIT_LOG',
    ]);
    // Newest first.
    const times = result.changes.map(item => Date.parse(item.at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(result.changes[1]!.title).toBe('Checkout failing');
    expect(result.changes[0]!.title).toBe('Restart checkout');
    expect(result.sources).toMatchObject({
      configuration: { status: 'ok', count: 1 },
      incidents: { status: 'ok', count: 1 },
      runbooks: { status: 'ok', count: 1 },
    });
    // Never claims to know about deploys, and never leaks runbook inputs or plans.
    expect(result.note).toMatch(/no deployment telemetry/);
    expect(JSON.stringify(result)).not.toMatch(/never-disclose|deploy(ed|ment) (at|of|to)/i);
    expect(JSON.stringify(result.changes)).not.toMatch(/deploy/i);
  });

  it('honours the window: older records are left out, and days is bounded', async () => {
    const admin = await principal('ADMIN', scopes);
    const service = await createTestService(`Window ${Math.random().toString(36).slice(2, 8)}`);
    await db.auditLog.createMany({
      data: [
        {
          action: 'service.updated',
          entityType: 'SERVICE',
          entityId: service.id,
          createdAt: new Date(Date.now() - 2 * DAY),
        },
        {
          action: 'service.updated',
          entityType: 'SERVICE',
          entityId: service.id,
          createdAt: new Date(Date.now() - 20 * DAY),
        },
      ],
    });
    expect((await run(admin, { serviceId: service.id, days: 7 })).changes).toHaveLength(1);
    expect((await run(admin, { serviceId: service.id, days: 30 })).changes).toHaveLength(2);
    // Out-of-range values are clamped, not trusted.
    expect((await run(admin, { serviceId: service.id, days: 400 })).window.days).toBe(30);
    expect((await run(admin, { serviceId: service.id, days: 0 })).window.days).toBe(1);
  });

  it('degrades in place when configuration history is not readable, and the rest still answers', async () => {
    const responder = await principal('RESPONDER', ['services:read', 'incidents:read']);
    const service = await createTestService(`Degrade ${Math.random().toString(36).slice(2, 8)}`);
    await db.auditLog.create({
      data: { action: 'service.updated', entityType: 'SERVICE', entityId: service.id },
    });
    await createTestIncident('Still visible', service.id, {
      createdAt: new Date(Date.now() - HOUR),
    });
    const result = await run(responder, { serviceId: service.id });
    expect(result.sources.configuration).toMatchObject({ status: 'unavailable' });
    expect(result.sources.configuration!.code).toBeTruthy();
    expect(result.sources.incidents).toMatchObject({ status: 'ok', count: 1 });
    expect(result.changes.map(item => item.source)).toEqual(['INCIDENT']);
    // The configuration entry is not smuggled in through another source.
    expect(JSON.stringify(result)).not.toContain('service.updated');
  });

  it('turns administrator-disabled sensitive reads into an unavailable source, not a failure', async () => {
    const admin = await principal('ADMIN', scopes);
    const service = await createTestService(`Sensitive ${Math.random().toString(36).slice(2, 8)}`);
    await db.mcpPolicy.update({ where: { id: 'default' }, data: { sensitiveReadsEnabled: false } });
    const result = await run(admin, { serviceId: service.id });
    expect(result.sources.configuration).toMatchObject({ status: 'unavailable' });
    expect(result.sources.incidents).toMatchObject({ status: 'ok' });
  });

  it('resolves a service name, asks instead of guessing, and needs exactly one identifier', async () => {
    const admin = await principal('ADMIN', scopes);
    const tag = Math.random().toString(36).slice(2, 8);
    const only = await createTestService(`Named ${tag}`);
    expect((await run(admin, { serviceName: only.name })).service).toMatchObject({ id: only.id });
    const a = await createTestService(`Pair ${tag} A`);
    const b = await createTestService(`Pair ${tag} B`);
    const ambiguous = await run(admin, { serviceName: `Pair ${tag}` });
    expect(ambiguous.service).toBeNull();
    expect(ambiguous.candidates!.map(candidate => candidate.id).sort()).toEqual(
      [a.id, b.id].sort()
    );
    expect(ambiguous.changes).toBeUndefined();
    for (const input of [{}, { serviceId: only.id, serviceName: only.name }])
      await expect(getMcpServiceChanges(admin.ctx(), input)).rejects.toThrow(
        'MCP_INVALID_ARGUMENTS'
      );
  });

  it('does not show another person a service they cannot read', async () => {
    const outsider = await principal('USER', ['services:read', 'incidents:read']);
    const service = await createTestService(`Hidden ${Math.random().toString(36).slice(2, 8)}`);
    await createTestIncident('Not theirs', service.id);
    // A scoped person gets "not found", never the incidents of a service they cannot read.
    await expect(getMcpServiceChanges(outsider.ctx(), { serviceId: service.id })).rejects.toThrow();
  });

  it('charges the quota for every read it can make', () => {
    expect(mcpCompositeCost('service_get_changes', { serviceId: 'svc_1' })).toBe(
      SERVICE_CHANGES_COST
    );
    expect(mcpCompositeCost('service_get_changes', { serviceName: 'payments' })).toBe(
      SERVICE_CHANGES_COST + 1
    );
  });
});
