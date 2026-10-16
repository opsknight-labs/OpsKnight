import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn().mockResolvedValue({ id: 'audit1' }) }));
vi.mock('@/lib/runbooks/locking', () => ({ lockRunbookForShare: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/runbooks/execution-preview', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/runbooks/execution-preview')>()),
  checkExecutionReadiness: vi.fn().mockResolvedValue([]),
}));

import { previewRunbookExecution } from '@/lib/runbooks/orchestrator';
import { computeDefinitionChecksum, parseRunbookDefinition } from '@/lib/runbooks/definition';

const RUNBOOK = 'crunbook00001';
const INCIDENT = 'cincident0001';
const SERVICE = 'cservice00001';
const AGENT = 'cagent0000001';
const POOL = 'cpool00000001';
const USER = 'cuser00000001';

const definition = parseRunbookDefinition({
  steps: [
    {
      key: 'status',
      name: 'Status',
      type: 'SYSTEMD',
      riskClass: 'READ_ONLY',
      config: { action: 'status', unit: 'api.service' },
    },
  ],
});

function fakeTx(overrides: { binding?: unknown; agent?: unknown; pool?: unknown } = {}) {
  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    $executeRaw: vi.fn().mockResolvedValue(0),
    runbook: {
      findFirst: vi.fn().mockResolvedValue({
        id: RUNBOOK,
        name: 'Status check',
        archivedAt: null,
        publishedVersionId: 'cversion00001',
      }),
    },
    serviceAutomationRule: { findFirst: vi.fn().mockResolvedValue(overrides.binding ?? null) },
    runbookSuggestion: { findFirst: vi.fn().mockResolvedValue(null) },
    incident: {
      findFirst: vi.fn().mockResolvedValue({ serviceId: SERVICE }),
      findUnique: vi.fn().mockResolvedValue({ tags: [] }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: INCIDENT,
        title: 'API down',
        description: null,
        status: 'OPEN',
        urgency: 'HIGH',
        priority: null,
        tags: [],
      }),
    },
    service: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: SERVICE, name: 'API', teamId: null }),
    },
    runbookVersion: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'cversion00001',
        runbookId: RUNBOOK,
        version: 1,
        state: 'PUBLISHED',
        definition,
        checksum: computeDefinitionChecksum(definition),
        inputs: [],
      }),
    },
    runbookAgent: {
      findFirst: vi.fn().mockResolvedValue('agent' in overrides ? overrides.agent : { id: AGENT }),
    },
    runbookAgentPool: {
      findUnique: vi.fn().mockResolvedValue('pool' in overrides ? overrides.pool : { id: POOL }),
    },
    runbookPreviewAuthorization: {
      create: vi.fn().mockResolvedValue({ id: 'grant', expiresAt: new Date() }),
    },
  };
}

const asTx = (tx: ReturnType<typeof fakeTx>) => tx as unknown as Prisma.TransactionClient;
const request = {
  runbookId: RUNBOOK,
  incidentId: INCIDENT,
  serviceId: SERVICE,
  triggeredByUserId: USER,
};

describe('ad-hoc incident runbook target selection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fails closed when Agent steps have no rule and no responder-selected target', async () => {
    await expect(previewRunbookExecution(request, asTx(fakeTx()))).rejects.toThrow(
      /TARGET_NOT_CONFIGURED/
    );
  });

  it('binds a responder-selected Agent into the previewed plan digest', async () => {
    const tx = fakeTx();
    const first = await previewRunbookExecution({ ...request, targetAgentId: AGENT }, asTx(tx));
    expect(first.agentId).toBe(AGENT);
    expect(tx.runbookAgent.findFirst).toHaveBeenCalledWith({
      where: { id: AGENT, status: { not: 'REVOKED' } },
      select: { id: true },
    });
    const other = await previewRunbookExecution(
      { ...request, targetAgentId: 'cagent0000002' },
      asTx(fakeTx({ agent: { id: 'cagent0000002' } }))
    );
    expect(other.digest).not.toBe(first.digest);
  });

  it('accepts a responder-selected Agent pool', async () => {
    const preview = await previewRunbookExecution(
      { ...request, targetAgentPoolId: POOL },
      asTx(fakeTx())
    );
    expect(preview.agentPoolId).toBe(POOL);
  });

  it('rejects unknown or revoked targets', async () => {
    await expect(
      previewRunbookExecution({ ...request, targetAgentId: AGENT }, asTx(fakeTx({ agent: null })))
    ).rejects.toThrow(/TARGET_NOT_FOUND/);
    await expect(
      previewRunbookExecution({ ...request, targetAgentPoolId: POOL }, asTx(fakeTx({ pool: null })))
    ).rejects.toThrow(/TARGET_NOT_FOUND/);
  });

  it('rejects selecting both an Agent and a pool', async () => {
    await expect(
      previewRunbookExecution(
        { ...request, targetAgentId: AGENT, targetAgentPoolId: POOL },
        asTx(fakeTx())
      )
    ).rejects.toThrow(/either a specific Agent or an Agent pool/);
  });

  it('never lets a target override a service rule', async () => {
    const binding = {
      id: 'cbinding00001',
      serviceId: SERVICE,
      runbookId: RUNBOOK,
      mode: 'MANUAL',
      versionStrategy: 'LATEST_PUBLISHED',
      runbookVersionId: null,
      defaultAgentId: 'cagentrule001',
      defaultAgentPoolId: null,
      agentSelector: {},
      inputValues: {},
    };
    await expect(
      previewRunbookExecution(
        { ...request, bindingId: binding.id, targetAgentId: AGENT },
        asTx(fakeTx({ binding }))
      )
    ).rejects.toThrow(/TARGET_OVERRIDE_NOT_ALLOWED/);
  });
});
