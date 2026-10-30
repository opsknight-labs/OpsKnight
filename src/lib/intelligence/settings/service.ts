import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { cache } from 'react';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import {
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
import { getAutoGate, getAutoGates } from '../evaluation/quality';

export type IntelligenceActor = { actorId: string } & (
  { source: 'UI' } | { source: 'API'; apiClientId: string }
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

/**
 * Settings and policy reads are memoised for the duration of one lane cycle. Every incident in a batch
 * resolves the same handful of rows, and each analysis step resolves them again; within a cycle (a few
 * seconds) they cannot meaningfully change, and the next cycle reads fresh values. Reads through a
 * transaction client are never memoised.
 */
const cycleMemo = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

export function withIntelligenceReadMemo<T>(work: () => Promise<T>): Promise<T> {
  return cycleMemo.run(new Map(), work);
}

function memoized<T>(key: string, client: Client, load: () => Promise<T>): Promise<T> {
  const store = cycleMemo.getStore();
  if (!store || client !== prisma) return load();
  const hit = store.get(key) as Promise<T> | undefined;
  if (hit) return hit;
  const pending = load().catch(error => {
    store.delete(key);
    throw error;
  });
  store.set(key, pending);
  return pending;
}

export function memoizeIntelligenceRead<T>(
  key: string,
  client: Client,
  load: () => Promise<T>
): Promise<T> {
  return memoized(key, client, load);
}

/** Reads never write: an absent singleton yields the safe defaults (disabled, revision 0). */
export async function getIntelligenceSettings(
  client: Client = prisma
): Promise<IntelligenceSettingsView> {
  return memoized('settings', client, async () => {
    const row = await client.intelligenceSettings.findUnique({
      where: { id: 'default' },
      select: SETTINGS_SELECT,
    });
    return row ?? { ...INTELLIGENCE_SETTINGS_DEFAULTS, revision: 0 };
  });
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
  return memoized(`policy:${scopeKey}`, client, () => loadHeadVersion(client, scopeKey));
}

async function loadHeadVersion(client: Client, scopeKey: string): Promise<PolicySnapshot | null> {
  const policy = await client.intelligencePolicy.findUnique({
    where: { scopeKey },
    select: { id: true, headVersion: true, overrideActive: true },
  });
  if (!policy || policy.headVersion === 0 || !policy.overrideActive) return null;
  const version = await client.intelligencePolicyVersion.findUnique({
    where: { policyId_version: { policyId: policy.id, version: policy.headVersion } },
    select: { version: true, mode: true, definition: true },
  });
  if (!version) return null;
  // Stored definitions are immutable but the schema may evolve; an unreadable one fails safe to OFF.
  const definition = policyDefinitionSchema.safeParse(version.definition);
  if (!definition.success) {
    return {
      scopeKey,
      policyId: policy.id,
      version: version.version,
      mode: 'OFF',
      definition: DEFAULT_POLICY_DEFINITION,
    };
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

/**
 * The effective policy for rendering a page: deduplicated per request, so the several intelligence cards on
 * an incident page resolve it once instead of once each.
 */
export const resolveEffectivePolicyForRequest = cache((serviceId: string | null) =>
  resolveEffectivePolicy(serviceId)
);

async function assertModeAllowed(
  mode: IntelligenceModeValue,
  serviceId: string | null | undefined,
  definition: PolicyDefinition,
  client: Client
) {
  if (mode !== 'AUTO') return;
  const gate = serviceId ? await getAutoGate(serviceId, definition, client) : null;
  if (!gate?.allowed) {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: gate?.reason ?? 'AUTO is available only through a certified per-service policy.',
      fields: [
        {
          field: 'mode',
          code: 'auto_unavailable',
          message: 'AUTO mode is not available for this service and policy.',
        },
      ],
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
    const service = await tx.service.findUnique({
      where: { id: scope.serviceId },
      select: { id: true },
    });
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
    // Publishing or restoring always (re)activates a service override.
    data: { headVersion: version, overrideActive: true },
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
  const scopeKey = resolvePolicyScopeKey(scope);

  const run = async (tx: Prisma.TransactionClient) => {
    await lockPolicyScope(tx, scopeKey);
    await assertModeAllowed(parsed.mode, scope.serviceId, parsed.definition, tx);
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
          {
            field: 'targetVersion',
            code: 'not_older',
            message: 'Target must be an older version.',
          },
        ],
      });
    }
    const target = await tx.intelligencePolicyVersion.findUnique({
      where: { policyId_version: { policyId: policy.id, version: parsed.targetVersion } },
      select: { mode: true, definition: true },
    });
    if (!target) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    const definition = parseOrThrow(policyDefinitionSchema, target.definition);
    await assertModeAllowed(target.mode, scope.serviceId, definition, tx);
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

/** Caller must authorize INTELLIGENCE_MANAGE. The service falls back to the global policy; history is kept. */
export async function clearServiceOverride(
  serviceId: string,
  actor: IntelligenceActor
): Promise<'cleared' | 'none'> {
  const scopeKey = servicePolicyScopeKey(serviceId);
  return prisma.$transaction(async tx => {
    await lockPolicyScope(tx, scopeKey);
    const previous = await readHeadVersion(tx, scopeKey);
    if (!previous) return 'none';
    await tx.intelligencePolicy.update({ where: { scopeKey }, data: { overrideActive: false } });
    await logAudit(
      {
        action: 'intelligence.policy.override_cleared',
        entityType: 'SYSTEM_CONFIG',
        entityId: `intelligence:${scopeKey}`,
        actorId: actor.actorId,
        ...auditSource(actor),
        oldValue: summarize(previous.version, previous.mode, previous.definition),
      },
      tx
    );
    return 'cleared';
  });
}

export interface ServicePolicyOverviewRow {
  serviceId: string;
  serviceName: string;
  source: 'service' | 'global' | 'default';
  mode: IntelligenceModeValue;
  effectiveMode: IntelligenceModeValue;
  version: number;
  similarityEnabled: boolean;
  responseEnabled: boolean;
  ruleCount: number;
  /** Head of the service's own policy history (0 if it never had one), for optimistic locking. */
  headVersion: number;
  autoAvailable: boolean;
  autoReason: string;
}

/**
 * Effective policy for a bounded page of services in a fixed number of queries (not one per service).
 * `serviceWhere` carries the caller's own visibility rule.
 */
export async function listServicePolicyOverview(
  options: { search?: string; limit?: number; serviceWhere?: Prisma.ServiceWhereInput } = {},
  client: Client = prisma
): Promise<ServicePolicyOverviewRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const search = options.search?.trim();
  const services = await client.service.findMany({
    where: {
      AND: [
        options.serviceWhere ?? {},
        search ? { name: { contains: search, mode: 'insensitive' as const } } : {},
      ],
    },
    orderBy: { name: 'asc' },
    take: limit,
    select: { id: true, name: true },
  });
  if (services.length === 0) return [];
  const [settings, globalPolicy, policies] = await Promise.all([
    getIntelligenceSettings(client),
    readHeadVersion(client, GLOBAL_POLICY_SCOPE_KEY),
    client.intelligencePolicy.findMany({
      where: { serviceId: { in: services.map(service => service.id) } },
      select: { id: true, serviceId: true, headVersion: true, overrideActive: true },
    }),
  ]);
  const active = policies.filter(policy => policy.overrideActive && policy.headVersion > 0);
  const headByService = new Map(policies.map(policy => [policy.serviceId, policy.headVersion]));
  const versions = active.length
    ? await client.intelligencePolicyVersion.findMany({
        where: { OR: active.map(policy => ({ policyId: policy.id, version: policy.headVersion })) },
        select: { policyId: true, version: true, mode: true, definition: true },
      })
    : [];
  const overrideByService = new Map<
    string,
    { mode: IntelligenceModeValue; version: number; definition: PolicyDefinition }
  >();
  for (const policy of active) {
    const head = versions.find(
      version => version.policyId === policy.id && version.version === policy.headVersion
    );
    if (!head || !policy.serviceId) continue;
    const definition = policyDefinitionSchema.safeParse(head.definition);
    overrideByService.set(policy.serviceId, {
      mode: definition.success ? head.mode : 'OFF',
      version: head.version,
      definition: definition.success ? definition.data : DEFAULT_POLICY_DEFINITION,
    });
  }
  const resolved = services.map(service => {
    const override = overrideByService.get(service.id);
    const chosen =
      override ??
      (globalPolicy
        ? {
            mode: globalPolicy.mode,
            version: globalPolicy.version,
            definition: globalPolicy.definition,
          }
        : null);
    const mode = chosen?.mode ?? 'OFF';
    const definition = chosen?.definition ?? DEFAULT_POLICY_DEFINITION;
    return {
      serviceId: service.id,
      serviceName: service.name,
      source: override
        ? ('service' as const)
        : globalPolicy
          ? ('global' as const)
          : ('default' as const),
      mode,
      effectiveMode: settings.enabled ? mode : 'OFF',
      version: chosen?.version ?? 0,
      similarityEnabled: definition.similarity.enabled,
      responseEnabled: definition.response.enabled,
      ruleCount: definition.correlation.rules.length,
      headVersion: headByService.get(service.id) ?? 0,
      definition,
    };
  });
  const gates = await getAutoGates(resolved, client);
  return resolved.map(({ definition: _definition, ...row }) => ({
    ...row,
    autoAvailable: gates.get(row.serviceId)?.allowed ?? false,
    autoReason: gates.get(row.serviceId)?.reason ?? 'No quality certification.',
  }));
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
  schema: {
    safeParse: (value: unknown) =>
      | { success: true; data: T }
      | {
          success: false;
          error: { issues: Array<{ path: PropertyKey[]; code: string; message: string }> };
        };
  },
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
