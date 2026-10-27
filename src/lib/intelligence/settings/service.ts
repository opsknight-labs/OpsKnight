import 'server-only';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import {
  AUTO_MODE_AVAILABLE,
  DEFAULT_POLICY_DEFINITION,
  GLOBAL_POLICY_SCOPE_KEY,
  INTELLIGENCE_SETTINGS_DEFAULTS,
  intelligenceSettingsInputSchema,
  policyDefinitionSchema,
  publishPolicyInputSchema,
  rollbackPolicyInputSchema,
  servicePolicyScopeKey,
  type IntelligenceModeValue,
  type IntelligenceSettingsInput,
  type PolicyDefinition,
} from '../contract';

export type IntelligenceActor = { actorId: string } & (
  | { source: 'UI' }
  | { source: 'API'; apiClientId: string }
);

type Client = Prisma.TransactionClient | typeof prisma;

export type IntelligenceSettingsView = {
  enabled: boolean;
  maxConcurrency: number;
  batchSize: number;
  maxJobMs: number;
  maxDbMs: number;
  candidateCap: number;
  lookbackDays: number;
  backpressureEscalationLagMs: number;
  fingerprintRetentionDays: number;
  correlationRetentionDays: number;
  findingRetentionDays: number;
  feedbackRetentionDays: number;
  /** 0 means the singleton row has not been written yet and defaults apply. */
  revision: number;
};

const SETTINGS_SELECT = {
  enabled: true,
  maxConcurrency: true,
  batchSize: true,
  maxJobMs: true,
  maxDbMs: true,
  candidateCap: true,
  lookbackDays: true,
  backpressureEscalationLagMs: true,
  fingerprintRetentionDays: true,
  correlationRetentionDays: true,
  findingRetentionDays: true,
  feedbackRetentionDays: true,
  revision: true,
} as const;

/** Reads never write: an absent singleton yields the safe defaults (disabled, revision 0). */
export async function getIntelligenceSettings(client: Client = prisma): Promise<IntelligenceSettingsView> {
  const row = await client.intelligenceSettings.findUnique({
    where: { id: 'default' },
    select: SETTINGS_SELECT,
  });
  return row ?? { ...INTELLIGENCE_SETTINGS_DEFAULTS, revision: 0 };
}

function auditSource(actor: IntelligenceActor) {
  return {
    source: actor.source,
    details: actor.source === 'API' ? { apiClientId: actor.apiClientId } : undefined,
  };
}

/** Caller must authorize INTELLIGENCE_MANAGE; the audit entry commits atomically with the write. */
export async function updateIntelligenceSettings(
  input: unknown,
  actor: IntelligenceActor,
  externalTx?: Prisma.TransactionClient
): Promise<IntelligenceSettingsView> {
  const parsed = parseOrThrow(intelligenceSettingsInputSchema, input);
  const { expectedRevision, ...values } = parsed;

  const run = async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('intelligence-settings', 0))`;
    const previous = await getIntelligenceSettings(tx);
    if (previous.revision !== expectedRevision) {
      throw new AppError({ code: 'PRECONDITION_FAILED' });
    }
    const next = await tx.intelligenceSettings.upsert({
      where: { id: 'default' },
      create: { ...values, revision: 1, updatedBy: actor.actorId },
      update: { ...values, revision: { increment: 1 }, updatedBy: actor.actorId },
      select: SETTINGS_SELECT,
    });
    await logAudit(
      {
        action: 'intelligence.settings.updated',
        entityType: 'SYSTEM_CONFIG',
        entityId: 'intelligence',
        actorId: actor.actorId,
        ...auditSource(actor),
        oldValue: previous,
        newValue: next,
      },
      tx
    );
    return next;
  };
  return externalTx ? run(externalTx) : prisma.$transaction(run);
}

export type PolicyScope = { serviceId?: string | null };

export function resolvePolicyScopeKey(scope: PolicyScope): string {
  return scope.serviceId ? servicePolicyScopeKey(scope.serviceId) : GLOBAL_POLICY_SCOPE_KEY;
}

export interface PolicySnapshot {
  scopeKey: string;
  policyId: string | null;
  version: number;
  mode: IntelligenceModeValue;
  definition: PolicyDefinition;
}

export interface EffectivePolicy extends PolicySnapshot {
  /** Mode actually applied: forced OFF while the global kill switch is off. */
  effectiveMode: IntelligenceModeValue;
  source: 'service' | 'global' | 'default';
}

const OFF_DEFAULT: Omit<PolicySnapshot, 'scopeKey'> = {
  policyId: null,
  version: 0,
  mode: 'OFF',
  definition: DEFAULT_POLICY_DEFINITION,
};

async function readHeadVersion(client: Client, scopeKey: string): Promise<PolicySnapshot | null> {
  const policy = await client.intelligencePolicy.findUnique({
    where: { scopeKey },
    select: { id: true, headVersion: true },
  });
  if (!policy || policy.headVersion === 0) return null;
  const version = await client.intelligencePolicyVersion.findUnique({
    where: { policyId_version: { policyId: policy.id, version: policy.headVersion } },
    select: { version: true, mode: true, definition: true },
  });
  if (!version) return null;
  // Stored definitions are immutable but the schema may evolve; an unreadable one fails safe to OFF.
  const definition = policyDefinitionSchema.safeParse(version.definition);
  if (!definition.success) {
    return { scopeKey, policyId: policy.id, version: version.version, mode: 'OFF', definition: DEFAULT_POLICY_DEFINITION };
  }
  return {
    scopeKey,
    policyId: policy.id,
    version: version.version,
    mode: version.mode,
    definition: definition.data,
  };
}

/** A service policy overrides the global policy; with neither, intelligence is OFF. */
export async function resolveEffectivePolicy(
  serviceId: string | null,
  client: Client = prisma
): Promise<EffectivePolicy> {
  const [settings, servicePolicy, globalPolicy] = await Promise.all([
    getIntelligenceSettings(client),
    serviceId ? readHeadVersion(client, servicePolicyScopeKey(serviceId)) : Promise.resolve(null),
    readHeadVersion(client, GLOBAL_POLICY_SCOPE_KEY),
  ]);
  const chosen = servicePolicy ?? globalPolicy;
  const source = servicePolicy ? 'service' : globalPolicy ? 'global' : 'default';
  const snapshot: PolicySnapshot = chosen ?? {
    ...OFF_DEFAULT,
    scopeKey: serviceId ? servicePolicyScopeKey(serviceId) : GLOBAL_POLICY_SCOPE_KEY,
  };
  return {
    ...snapshot,
    source,
    effectiveMode: settings.enabled ? snapshot.mode : 'OFF',
  };
}

function assertModeAllowed(mode: IntelligenceModeValue) {
  if (mode === 'AUTO' && !AUTO_MODE_AVAILABLE) {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage:
        'AUTO mode is not available yet. It is enabled only after shadow-quality, fault-tolerance and ingestion-performance certification.',
      fields: [{ field: 'mode', code: 'auto_unavailable', message: 'AUTO mode is not available.' }],
    });
  }
}

function summarize(version: number, mode: IntelligenceModeValue, definition: PolicyDefinition) {
  return {
    version,
    mode,
    ruleCount: definition.correlation.rules.length,
    similarityEnabled: definition.similarity.enabled,
  };
}

async function lockPolicyScope(tx: Prisma.TransactionClient, scopeKey: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`intelligence-policy:${scopeKey}`}, 0))`;
}

async function ensurePolicy(tx: Prisma.TransactionClient, scope: PolicyScope, scopeKey: string) {
  if (scope.serviceId) {
    const service = await tx.service.findUnique({ where: { id: scope.serviceId }, select: { id: true } });
    if (!service) throw new AppError({ code: 'SERVICE_NOT_FOUND' });
  }
  return tx.intelligencePolicy.upsert({
    where: { scopeKey },
    create: { scopeKey, serviceId: scope.serviceId ?? null },
    update: {},
    select: { id: true, headVersion: true },
  });
}

/** Advances the head with compare-and-set; two publishers can never both write version N+1. */
async function appendVersion(
  tx: Prisma.TransactionClient,
  policy: { id: string; headVersion: number },
  expectedHeadVersion: number,
  data: {
    mode: IntelligenceModeValue;
    definition: PolicyDefinition;
    reason?: string;
    createdFromVersion?: number;
    actorId: string;
  }
) {
  if (policy.headVersion !== expectedHeadVersion) {
    throw new AppError({ code: 'PRECONDITION_FAILED' });
  }
  const version = policy.headVersion + 1;
  const advanced = await tx.intelligencePolicy.updateMany({
    where: { id: policy.id, headVersion: policy.headVersion },
    data: { headVersion: version },
  });
  if (advanced.count !== 1) throw new AppError({ code: 'PRECONDITION_FAILED' });
  await tx.intelligencePolicyVersion.create({
    data: {
      policyId: policy.id,
      version,
      mode: data.mode,
      definition: data.definition as Prisma.InputJsonValue,
      reason: data.reason ?? null,
      createdFromVersion: data.createdFromVersion ?? null,
      createdById: data.actorId,
    },
  });
  return version;
}

/** Caller must authorize INTELLIGENCE_MANAGE. Publishing always creates a new immutable version. */
export async function publishPolicyVersion(
  scope: PolicyScope,
  input: unknown,
  actor: IntelligenceActor,
  externalTx?: Prisma.TransactionClient
): Promise<{ version: number; scopeKey: string }> {
  const parsed = parseOrThrow(publishPolicyInputSchema, input);
  assertModeAllowed(parsed.mode);
  const scopeKey = resolvePolicyScopeKey(scope);

  const run = async (tx: Prisma.TransactionClient) => {
    await lockPolicyScope(tx, scopeKey);
    const policy = await ensurePolicy(tx, scope, scopeKey);
    const previous = await readHeadVersion(tx, scopeKey);
    const version = await appendVersion(tx, policy, parsed.expectedHeadVersion, {
      mode: parsed.mode,
      definition: parsed.definition,
      reason: parsed.reason,
      actorId: actor.actorId,
    });
    await logAudit(
      {
        action: 'intelligence.policy.published',
        entityType: 'SYSTEM_CONFIG',
        entityId: `intelligence:${scopeKey}`,
        actorId: actor.actorId,
        ...auditSource(actor),
        oldValue: previous ? summarize(previous.version, previous.mode, previous.definition) : null,
        newValue: summarize(version, parsed.mode, parsed.definition),
      },
      tx
    );
    return { version, scopeKey };
  };
  return externalTx ? run(externalTx) : prisma.$transaction(run);
}

/**
 * Rollback never repoints history: it publishes a NEW version cloned from the target, so every past
 * decision keeps referencing the exact version that made it and the full trail is retained.
 */
export async function rollbackPolicy(
  scope: PolicyScope,
  input: unknown,
  actor: IntelligenceActor,
  externalTx?: Prisma.TransactionClient
): Promise<{ version: number; scopeKey: string; restoredFrom: number }> {
  const parsed = parseOrThrow(rollbackPolicyInputSchema, input);
  const scopeKey = resolvePolicyScopeKey(scope);

  const run = async (tx: Prisma.TransactionClient) => {
    await lockPolicyScope(tx, scopeKey);
    const policy = await tx.intelligencePolicy.findUnique({
      where: { scopeKey },
      select: { id: true, headVersion: true },
    });
    if (!policy) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    if (parsed.targetVersion >= policy.headVersion) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        fields: [
          { field: 'targetVersion', code: 'not_older', message: 'Target must be an older version.' },
        ],
      });
    }
    const target = await tx.intelligencePolicyVersion.findUnique({
      where: { policyId_version: { policyId: policy.id, version: parsed.targetVersion } },
      select: { mode: true, definition: true },
    });
    if (!target) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    assertModeAllowed(target.mode);
    const definition = parseOrThrow(policyDefinitionSchema, target.definition);
    const previous = await readHeadVersion(tx, scopeKey);
    const version = await appendVersion(tx, policy, parsed.expectedHeadVersion, {
      mode: target.mode,
      definition,
      reason: parsed.reason,
      createdFromVersion: parsed.targetVersion,
      actorId: actor.actorId,
    });
    await logAudit(
      {
        action: 'intelligence.policy.rolled_back',
        entityType: 'SYSTEM_CONFIG',
        entityId: `intelligence:${scopeKey}`,
        actorId: actor.actorId,
        ...auditSource(actor),
        details: { restoredFrom: parsed.targetVersion },
        oldValue: previous ? summarize(previous.version, previous.mode, previous.definition) : null,
        newValue: summarize(version, target.mode, definition),
      },
      tx
    );
    return { version, scopeKey, restoredFrom: parsed.targetVersion };
  };
  return externalTx ? run(externalTx) : prisma.$transaction(run);
}

export async function listPolicyVersions(
  scope: PolicyScope,
  options: { limit?: number; beforeVersion?: number } = {},
  client: Client = prisma
) {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const policy = await client.intelligencePolicy.findUnique({
    where: { scopeKey: resolvePolicyScopeKey(scope) },
    select: { id: true, headVersion: true },
  });
  if (!policy) return { headVersion: 0, versions: [] };
  const versions = await client.intelligencePolicyVersion.findMany({
    where: {
      policyId: policy.id,
      ...(options.beforeVersion ? { version: { lt: options.beforeVersion } } : {}),
    },
    orderBy: { version: 'desc' },
    take: limit,
    select: {
      version: true,
      mode: true,
      reason: true,
      createdFromVersion: true,
      createdById: true,
      createdAt: true,
    },
  });
  return { headVersion: policy.headVersion, versions };
}

export function parseOrThrow<T>(
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: { issues: Array<{ path: PropertyKey[]; code: string; message: string }> } } },
  input: unknown
): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new AppError({
    code: 'VALIDATION_FAILED',
    fields: result.error.issues.map(issue => ({
      field: issue.path.map(String).join('.') || 'input',
      code: issue.code,
      message: issue.message,
    })),
  });
}

export type { IntelligenceSettingsInput };
