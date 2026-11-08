import 'server-only';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { decrypt, encrypt } from '@/lib/encryption';
import { logger } from '@/lib/logger';
import {
  authorize,
  AUTHORIZATION_ACTIONS,
  type AuthorizationActor,
} from '@/lib/authorization-policy';
import { validateProviderEndpoint } from '../ai/settings';
import { parseOrThrow, type IntelligenceActor } from '../settings/service';
import { CONNECTOR_ADAPTERS } from './adapters';
import type { AdapterContext, ConnectorCredential, ResolvedConnection } from './adapters/types';
import {
  CONNECTOR_BOUNDS,
  KIND_CAPABILITIES,
  KIND_DEFAULT_BASE_URL,
  observabilityConnectionInputSchema,
  type ConnectorCapability,
  type ConnectorTestResult,
  type ObservabilityConnectionInput,
  type ObservabilityConnectionView,
  type ObservabilityKind,
} from './contract';
import { ConnectorError, connectorFetchFor, type ConnectorFetch } from './http';

type Client = Prisma.TransactionClient | typeof prisma;

const SELECT = {
  id: true,
  name: true,
  kind: true,
  baseUrl: true,
  credentialEncrypted: true,
  region: true,
  org: true,
  project: true,
  allowedTeamIds: true,
  allowPrivateNetwork: true,
  enabled: true,
  timeoutMs: true,
  updatedAt: true,
} as const;
type Row = Prisma.ObservabilityConnectionGetPayload<{ select: typeof SELECT }>;

function toView(row: Row): ObservabilityConnectionView {
  const { credentialEncrypted, updatedAt, ...rest } = row;
  return {
    ...rest,
    kind: rest.kind as ObservabilityKind,
    allowedTeamIds: [...rest.allowedTeamIds],
    hasCredential: Boolean(credentialEncrypted),
    updatedAt: updatedAt.toISOString(),
  };
}

/** What the audit log records: never the credential, only whether one is stored or was replaced. */
const auditView = (view: ObservabilityConnectionView) => ({
  ...view,
  allowedTeamIds: [...view.allowedTeamIds],
});

const auditSource = (actor: IntelligenceActor) => ({
  source: actor.source,
  details: actor.source === 'API' ? { apiClientId: actor.apiClientId } : undefined,
});

function invalid(field: string, message: string): AppError {
  return new AppError({ code: 'VALIDATION_FAILED', fields: [{ field, code: 'custom', message }] });
}

export async function listObservabilityConnections(
  client: Client = prisma
): Promise<ObservabilityConnectionView[]> {
  const rows = await client.observabilityConnection.findMany({
    orderBy: { name: 'asc' },
    take: CONNECTOR_BOUNDS.maxConnections,
    select: SELECT,
  });
  return rows.map(toView);
}

function endpointFor(parsed: ObservabilityConnectionInput): string {
  if (parsed.baseUrl) return parsed.baseUrl;
  if (parsed.kind === 'CLOUDWATCH') return `https://monitoring.${parsed.region}.amazonaws.com`;
  const fallback = KIND_DEFAULT_BASE_URL[parsed.kind];
  if (!fallback) throw invalid('baseUrl', 'A base URL is required');
  return fallback;
}

/**
 * Creates or updates a connection. Caller must authorize INTELLIGENCE_MANAGE. The endpoint is validated the
 * same way as an AI provider's (HTTPS and public addresses unless private-network consent is given; metadata
 * addresses never), the credential is encrypted with the application key, and the audit entry commits in
 * the same transaction.
 */
export async function saveObservabilityConnection(
  id: string | null,
  input: unknown,
  actor: IntelligenceActor
): Promise<ObservabilityConnectionView> {
  const parsed = parseOrThrow(observabilityConnectionInputSchema, input);
  const baseUrl = await validateProviderEndpoint(endpointFor(parsed), parsed.allowPrivateNetwork);
  if (parsed.secondary && !parsed.secret)
    throw invalid('secret', 'Enter the secret as well when changing the key ID or user name');
  const credentialEncrypted = parsed.secret
    ? await encrypt(
        JSON.stringify({
          secret: parsed.secret,
          ...(parsed.secondary ? { secondary: parsed.secondary } : {}),
        } satisfies ConnectorCredential)
      )
    : undefined;
  const data = {
    name: parsed.name,
    kind: parsed.kind,
    baseUrl,
    region: parsed.region ?? null,
    org: parsed.org ?? null,
    project: parsed.project ?? null,
    allowedTeamIds: parsed.allowedTeamIds,
    allowPrivateNetwork: parsed.allowPrivateNetwork,
    enabled: parsed.enabled,
    timeoutMs: parsed.timeoutMs,
    updatedById: actor.actorId,
  };

  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('observability-connections', 0))`;
    if (data.allowedTeamIds.length) {
      const known = await tx.team.count({ where: { id: { in: data.allowedTeamIds } } });
      if (known !== data.allowedTeamIds.length)
        throw invalid('allowedTeamIds', 'One or more teams no longer exist');
    }
    if (
      id === null &&
      (await tx.observabilityConnection.count()) >= CONNECTOR_BOUNDS.maxConnections
    )
      throw invalid('name', 'Connection limit reached');
    const duplicate = await tx.observabilityConnection.findFirst({
      where: { name: data.name, ...(id ? { id: { not: id } } : {}) },
      select: { id: true },
    });
    if (duplicate) throw invalid('name', 'A connection with this name already exists');

    let previous: ObservabilityConnectionView | null = null;
    let row: Row;
    if (id === null) {
      if (parsed.kind === 'CLOUDWATCH' && !credentialEncrypted)
        throw invalid('secret', 'Enter AWS access keys');
      row = await tx.observabilityConnection.create({
        data: {
          ...data,
          createdById: actor.actorId,
          credentialEncrypted: credentialEncrypted ?? null,
        },
        select: SELECT,
      });
    } else {
      const existing = await tx.observabilityConnection.findUnique({
        where: { id },
        select: SELECT,
      });
      if (!existing) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
      previous = toView(existing);
      // A stored credential has the shape of its kind, so changing kind requires a new one.
      if (existing.kind !== data.kind && existing.credentialEncrypted && !credentialEncrypted)
        throw invalid('kind', 'Enter new credentials when changing the connection type');
      // Re-pointing a stored credential at another host would hand it to that host.
      if (
        existing.credentialEncrypted &&
        !credentialEncrypted &&
        new URL(existing.baseUrl).origin !== new URL(data.baseUrl).origin
      )
        throw invalid('secret', 'Enter the credential again when changing the address');
      row = await tx.observabilityConnection.update({
        where: { id },
        data: { ...data, ...(credentialEncrypted !== undefined ? { credentialEncrypted } : {}) },
        select: SELECT,
      });
    }
    const view = toView(row);
    await logAudit(
      {
        action: id === null ? 'intelligence.connector.created' : 'intelligence.connector.updated',
        entityType: 'SYSTEM_CONFIG',
        entityId: row.id,
        actorId: actor.actorId,
        ...auditSource(actor),
        ...(previous ? { oldValue: auditView(previous) } : {}),
        newValue: { ...auditView(view), credentialReplaced: credentialEncrypted !== undefined },
      },
      tx
    );
    return view;
  });
}

export async function deleteObservabilityConnection(
  id: string,
  actor: IntelligenceActor
): Promise<'deleted' | 'not_found'> {
  return prisma.$transaction(async tx => {
    const row = await tx.observabilityConnection.findUnique({ where: { id }, select: SELECT });
    if (!row) return 'not_found';
    await tx.observabilityConnection.delete({ where: { id } });
    await logAudit(
      {
        action: 'intelligence.connector.deleted',
        entityType: 'SYSTEM_CONFIG',
        entityId: id,
        actorId: actor.actorId,
        ...auditSource(actor),
        oldValue: auditView(toView(row)),
      },
      tx
    );
    return 'deleted';
  });
}

/**
 * The connections a person may have Squire query: enabled ones whose team list is empty or shares a team
 * with them. People who can read every service (administrators) can use every enabled connection. API keys,
 * inactive accounts and people without service access get none.
 */
export function connectionReadWhere(
  actor: AuthorizationActor
): Prisma.ObservabilityConnectionWhereInput | null {
  if (actor.status !== 'ACTIVE' || actor.apiKey) return null;
  const decision = authorize({ actor, action: AUTHORIZATION_ACTIONS.SERVICE_READ });
  if (!decision.allowed) return null;
  if (decision.scope === 'global') return { enabled: true };
  return {
    enabled: true,
    OR: [
      { allowedTeamIds: { isEmpty: true } },
      { allowedTeamIds: { hasSome: [...actor.teamIds] } },
    ],
  };
}

export interface EligibleConnection {
  id: string;
  name: string;
  kind: ObservabilityKind;
  baseUrl: string;
  capabilities: readonly ConnectorCapability[];
}

/** Enabled connections this person may use, for deciding which tools Squire is offered. */
export async function listEligibleConnections(
  actor: AuthorizationActor,
  client: Client = prisma
): Promise<EligibleConnection[]> {
  const where = connectionReadWhere(actor);
  if (!where) return [];
  const rows = await client.observabilityConnection.findMany({
    where,
    orderBy: { name: 'asc' },
    take: CONNECTOR_BOUNDS.maxConnections,
    select: { id: true, name: true, kind: true, baseUrl: true },
  });
  return rows.map(row => ({
    ...row,
    kind: row.kind as ObservabilityKind,
    capabilities: KIND_CAPABILITIES[row.kind as ObservabilityKind],
  }));
}

function readCredential(secret: string | null): ConnectorCredential {
  if (!secret) return {};
  try {
    const value = JSON.parse(secret) as Record<string, unknown>;
    return {
      ...(typeof value.secret === 'string' ? { secret: value.secret } : {}),
      ...(typeof value.secondary === 'string' ? { secondary: value.secondary } : {}),
    };
  } catch {
    // An unreadable credential is treated as missing; the vendor then rejects the request.
    return {};
  }
}

async function resolve(row: Row): Promise<ResolvedConnection> {
  const secret = row.credentialEncrypted
    ? await decrypt(row.credentialEncrypted).catch(() => null)
    : null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as ObservabilityKind,
    baseUrl: row.baseUrl,
    region: row.region,
    org: row.org,
    project: row.project,
    allowPrivateNetwork: row.allowPrivateNetwork,
    timeoutMs: row.timeoutMs,
    credential: readCredential(secret),
  };
}

/**
 * Loads one connection with its decrypted credential, re-checking at execution time that it is still
 * enabled and still allowed for this person. Server-only; the result must never be returned to a client.
 */
export async function loadConnectionForActor(
  actor: AuthorizationActor,
  id: string
): Promise<ResolvedConnection | null> {
  const where = connectionReadWhere(actor);
  if (!where) return null;
  const row = await prisma.observabilityConnection.findFirst({
    where: { AND: [{ id }, where] },
    select: SELECT,
  });
  return row ? resolve(row) : null;
}

export function contextFor(
  connection: ResolvedConnection,
  options: { fetch?: ConnectorFetch; signal?: AbortSignal } = {}
): AdapterContext {
  return {
    connection,
    fetch: options.fetch ?? connectorFetchFor(connection),
    signal: options.signal,
  };
}

const TEST_REASONS: Record<
  Exclude<ConnectorError['code'], 'ABORTED'>,
  Extract<ConnectorTestResult, { ok: false }>['reason']
> = {
  BLOCKED: 'BLOCKED',
  UNREACHABLE: 'UNREACHABLE',
  TIMEOUT: 'TIMEOUT',
  TOO_LARGE: 'TOO_LARGE',
  HTTP_ERROR: 'FAILED',
  INVALID_RESPONSE: 'FAILED',
  UNSUPPORTED: 'UNSUPPORTED',
};

/** Runs the kind's harmless read against a saved connection (enabled or not). Caller must authorize. */
export async function testObservabilityConnection(
  id: string,
  options: { fetch?: ConnectorFetch } = {}
): Promise<ConnectorTestResult> {
  const row = await prisma.observabilityConnection.findUnique({ where: { id }, select: SELECT });
  if (!row) return { ok: false, reason: 'NOT_FOUND' };
  const connection = await resolve(row);
  const started = Date.now();
  try {
    await CONNECTOR_ADAPTERS[connection.kind].test(contextFor(connection, options));
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    if (!(error instanceof ConnectorError) || error.code === 'ABORTED')
      return { ok: false, reason: 'FAILED' };
    logger.info('[Intelligence] Connector test failed', {
      kind: connection.kind,
      code: error.code,
      status: error.status,
    });
    if (error.code === 'HTTP_ERROR' && (error.status === 401 || error.status === 403))
      return { ok: false, reason: 'REJECTED' };
    return { ok: false, reason: TEST_REASONS[error.code] };
  }
}
