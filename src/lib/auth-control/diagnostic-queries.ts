import 'server-only';
import { redactDiagnosticText } from './diagnostic-safety';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getAuthenticationPolicy } from '@/lib/authentication-policy';
import type { ControlActor } from './actor';
import {
  diagnosticQuerySchema,
  type DiagnosticQuery,
  type DiagnosticItem,
  type DiagnosticPage,
} from './diagnostic-contract';
import {
  decodeDiagnosticCursor,
  diagnosticContext,
  encodeDiagnosticCursor,
  type DiagnosticCursor,
} from './diagnostic-cursor';

type Row = { id: string; at: Date; createdAt: Date; [key: string]: unknown };
const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : '');
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const detail = (label: string, value: unknown) => ({
  label,
  value: redactDiagnosticText(text(value) || String(value ?? 'Not recorded')),
});
// Only fixed setting names cross the API boundary; observed values can contain private identities.
function replicaMismatchNames(snapshot: unknown, imported: unknown, differs: boolean) {
  if (!differs) return 'None reported';
  if (!snapshot || typeof snapshot !== 'object') return 'Names not recorded';
  const allowed = [
    'localLoginEnabled',
    'breakGlassEnabled',
    'breakGlassEmail',
    'authenticationOrigin',
  ];
  const recorded = Object.entries(snapshot).find(([key]) => key === 'mismatchNames')?.[1];
  if (Array.isArray(recorded)) {
    return (
      recorded
        .filter((name): name is string => typeof name === 'string' && allowed.includes(name))
        .join(', ') || 'Names not recorded'
    );
  }
  // Older observations predate recording mismatch names. Compare only the immutable import.
  const original = imported && typeof imported === 'object' ? Object.entries(imported) : [];
  const names = Object.entries(snapshot)
    .filter(
      ([key, value]) =>
        allowed.includes(key) &&
        key !== 'authenticationOrigin' &&
        original.find(([name]) => name === key)?.[1] !== value
    )
    .map(([key]) => key);
  return names.join(', ') || 'Names not recorded; compare canonical public URLs';
}
function dateWindow(query: DiagnosticQuery, snapshot: Date) {
  const from =
    query.range === 'custom'
      ? new Date(query.from!)
      : query.range === 'all'
        ? null
        : new Date(
            snapshot.getTime() -
              { '24h': 86400000, '7d': 604800000, '30d': 2592000000 }[query.range]
          );
  return {
    from,
    to:
      query.range === 'custom'
        ? new Date(Math.min(Date.parse(query.to!), snapshot.getTime()))
        : snapshot,
  };
}
function boundary(column: Prisma.Sql, cursor: DiagnosticCursor | null) {
  return cursor
    ? Prisma.sql`AND (${column}, id) < (${new Date(cursor.at)}, ${cursor.id})`
    : Prisma.empty;
}
function prefix(value: string) {
  return value.toLowerCase().replace(/[\\%_]/g, '\\$&') + '%';
}

/** Filters execute in PostgreSQL before LIMIT. No session token/JTI is selected. */
export async function authenticationDiagnosticPage(
  actor: ControlActor,
  input: DiagnosticQuery
): Promise<DiagnosticPage> {
  const query = diagnosticQuerySchema.parse(input);
  const policy = await getAuthenticationPolicy();
  const context = diagnosticContext(query, `${actor.kind}:${actor.id}`, policy.version);
  const cursor = query.after ? await decodeDiagnosticCursor(query.after, context) : null;
  const snapshotAt = cursor?.snapshotAt ?? new Date().toISOString();
  const snapshot = new Date(snapshotAt);
  const { from, to } = dateWindow(query, snapshot);
  const fresh = Date.now() - actor.authenticatedAt < 300000;
  const result = await prisma.$transaction(
    async tx => {
      // Prisma DateTime columns store UTC without a zone; raw cursor comparisons must not inherit the server timezone.
      await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '1500ms'`;
      await tx.$executeRaw`SET LOCAL lock_timeout = '250ms'`;
      let rows: Row[];
      let items: DiagnosticItem[];
      if (query.view === 'sessions') {
        const [projection] = await tx.$queryRaw<Array<{ pending: boolean }>>`SELECT EXISTS (
          SELECT 1 FROM "UserDevice" WHERE "deviceId" LIKE 'session:%' AND "sessionDiagnosticProjectedAt" IS NULL
        ) AS pending`;
        if (projection.pending) throw new Error('Historical session preparation is incomplete.');
        const localAllowed = policy.passwordRecoveryUserId
          ? Prisma.sql`d."userId" = ${policy.passwordRecoveryUserId} AND ${Boolean(policy.passwordRecoveryExpiresAt && policy.passwordRecoveryExpiresAt > snapshot)}`
          : Prisma.sql`${policy.mode !== 'SSO_REQUIRED'}`;
        const state = Prisma.sql`CASE
        WHEN u.status <> 'ACTIVE' THEN 'REVOKED'
        WHEN d.platform NOT IN ('session:OIDC','session:STANDARD','session:TRUSTED_PWA') THEN 'REVOKED'
        WHEN d."sessionPolicyVersion" IS NOT NULL AND (d."sessionPolicyVersion" < 1 OR d."sessionPolicyVersion" > ${policy.version}) THEN 'REVOKED'
        WHEN d.platform = 'session:OIDC' AND (${policy.mode === 'PASSWORD_ONLY'} OR COALESCE(d."sessionPolicyVersion",0) < ${policy.oidcSessionMinVersion ?? 0}) THEN 'REVOKED'
        WHEN d.platform <> 'session:OIDC' AND (NOT (${localAllowed}) OR COALESCE(d."sessionPolicyVersion",0) < ${policy.passwordSessionMinVersion ?? 0}) THEN 'REVOKED'
        WHEN d."sessionExpiresAt" IS NULL OR d."sessionExpiresAt" <= ${snapshot} THEN 'EXPIRED'
        ELSE 'ACTIVE' END`;
        // SQL identifiers are a closed server-owned selection, never interpolated user text.
        const sort =
          query.sort === 'created'
            ? Prisma.sql`d."createdAt"`
            : query.sort === 'expires'
              ? Prisma.sql`COALESCE(d."sessionExpiresAt",TIMESTAMP '1970-01-01')`
              : Prisma.sql`d."lastUsed"`;
        rows = await tx.$queryRaw<Row[]>(Prisma.sql`WITH selected AS (
        SELECT d.id, d."createdAt", d."lastUsed", d."sessionExpiresAt", d."sessionPolicyVersion",
          u.email, u.name, ${sort} AS at, ${state} AS state,
          CASE WHEN d.platform IN ('session:OIDC','session:REVOKED:OIDC') THEN 'oidc' ELSE 'credentials' END AS method
        FROM "UserDevice" d JOIN "User" u ON u.id = d."userId"
        WHERE d."deviceId" LIKE 'session:%' AND d."sessionDiagnosticProjectedAt" IS NOT NULL AND d."createdAt" <= ${to} AND d."updatedAt" <= ${snapshot}
          ${from ? Prisma.sql`AND d."createdAt" >= ${from}` : Prisma.empty}
          ${query.q ? Prisma.sql`AND (LOWER(u.email) LIKE ${prefix(query.q)} OR LOWER(u.name) LIKE ${prefix(query.q)} OR LOWER(d.id) LIKE ${prefix(query.q)})` : Prisma.empty}
          ${query.method !== 'all' ? (query.method === 'oidc' ? Prisma.sql`AND d.platform IN ('session:OIDC','session:REVOKED:OIDC')` : Prisma.sql`AND d.platform NOT IN ('session:OIDC','session:REVOKED:OIDC')`) : Prisma.empty}
      ) SELECT * FROM selected WHERE TRUE
        ${query.state !== 'all' ? Prisma.sql`AND state = ${query.state}` : Prisma.empty}
        ${boundary(Prisma.sql`at`, cursor)} ORDER BY at DESC,id DESC LIMIT ${query.pageSize + 1}`);
        items = rows.slice(0, query.pageSize).map(row => ({
          id: row.id,
          title: text(row.name) || text(row.email),
          subtitle: text(row.email),
          state: text(row.state),
          createdAt: iso(row.createdAt),
          activityAt: iso(row.lastUsed),
          source: 'Registered authentication session',
          details: [
            detail('Authentication method', row.method === 'oidc' ? 'OIDC' : 'Password'),
            detail('Issued at', iso(row.createdAt)),
            detail('Last activity', iso(row.lastUsed)),
            detail('Expires', iso(row.sessionExpiresAt) || 'Not recorded'),
            detail('Issuing policy version', row.sessionPolicyVersion),
            detail('Session record identifier', row.id),
          ],
          canRevoke:
            row.state === 'ACTIVE' &&
            fresh &&
            row.sessionExpiresAt instanceof Date &&
            row.sessionExpiresAt.getTime() > Date.now(),
          actionExplanation:
            row.state !== 'ACTIVE'
              ? 'This session is already expired, revoked or disallowed by policy.'
              : !fresh
                ? 'Authenticate again before revoking a session.'
                : !(row.sessionExpiresAt instanceof Date) ||
                    row.sessionExpiresAt.getTime() <= Date.now()
                  ? 'This session expired after the snapshot started. Refresh from the first page to see its current state.'
                  : 'Revocation ends this registered session immediately.',
        }));
      } else if (query.view === 'audit') {
        rows = await tx.$queryRaw<
          Row[]
        >(Prisma.sql`SELECT id,"createdAt", "createdAt" AS at,"eventType",outcome,"emergencyAccountId",context
        FROM "EmergencyAccessEvent" WHERE "createdAt" <= ${to}
        ${from ? Prisma.sql`AND "createdAt" >= ${from}` : Prisma.empty}
        ${query.eventType ? Prisma.sql`AND "eventType" = ${query.eventType}` : Prisma.empty}
        ${query.outcome ? Prisma.sql`AND outcome = ${query.outcome}` : Prisma.empty}
        ${query.actor ? Prisma.sql`AND "emergencyAccountId" = ${query.actor}` : Prisma.empty}
        ${query.q ? Prisma.sql`AND (LOWER("eventType") LIKE ${prefix(query.q)} OR LOWER(id) LIKE ${prefix(query.q)})` : Prisma.empty}
        ${boundary(Prisma.sql`"createdAt"`, cursor)} ORDER BY "createdAt" DESC,id DESC LIMIT ${query.pageSize + 1}`);
        items = rows.slice(0, query.pageSize).map(row => {
          const safeContext =
            row.context && typeof row.context === 'object'
              ? (row.context as Record<string, unknown>)
              : {};
          const permitted = [
            'reason',
            'method',
            'scope',
            'revisionId',
            'authorizedBy',
            'urgentRemediation',
            'emergencyAccountId',
            'credentialId',
            'correlationId',
          ];
          const authority = text(safeContext.authorizedBy);
          const category = /^(admin|emergency|legacy):/.exec(authority)?.[1];
          return {
            id: row.id,
            title: text(row.eventType),
            subtitle: text(row.emergencyAccountId) || 'Anonymous / no principal recorded',
            state: text(row.outcome),
            createdAt: iso(row.createdAt),
            activityAt: iso(row.createdAt),
            source: 'EmergencyAccessEvent · persisted authentication audit',
            details: [
              detail('Actor category', category ?? 'Not explicitly recorded'),
              detail('Affected / recorded principal identifier', row.emergencyAccountId),
              detail('Event correlation identifier', row.id),
              ...Object.entries(safeContext)
                .filter(([key]) => permitted.includes(key))
                .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
                .map(([key, value]) => detail(key, value)),
            ],
          };
        });
      } else if (query.view === 'replicas') {
        rows = await tx.$queryRaw<
          Row[]
        >(Prisma.sql`SELECT id,"firstSeenAt" AS "createdAt","lastSeenAt" AS at,differs,snapshot
        FROM "AuthenticationReplicaObservation" WHERE "lastSeenAt" <= ${to}
        ${from ? Prisma.sql`AND "lastSeenAt" >= ${from}` : Prisma.empty}
        ${query.observation === 'active' ? Prisma.sql`AND "lastSeenAt" > ${new Date(snapshot.getTime() - 600000)}` : query.observation === 'historical' ? Prisma.sql`AND "lastSeenAt" <= ${new Date(snapshot.getTime() - 600000)}` : Prisma.empty}
        ${query.state === 'conflicting' ? Prisma.sql`AND differs = true` : query.state === 'consistent' ? Prisma.sql`AND differs = false` : Prisma.empty}
        ${query.q ? Prisma.sql`AND LOWER(id) LIKE ${prefix(query.q)}` : Prisma.empty}
        ${boundary(Prisma.sql`"lastSeenAt"`, cursor)} ORDER BY "lastSeenAt" DESC,id DESC LIMIT ${query.pageSize + 1}`);
        items = rows.slice(0, query.pageSize).map(row => ({
          id: row.id,
          title: `Web replica ${row.id}`,
          subtitle: row.differs
            ? 'Deployment authentication settings need attention'
            : 'Reported settings agree with the imported policy',
          state: row.differs ? 'CONFLICTING' : 'CONSISTENT',
          createdAt: iso(row.createdAt),
          activityAt: iso(row.at),
          source: 'AuthenticationReplicaObservation · last reported state',
          details: [
            detail('Last report', iso(row.at)),
            detail('First observed', iso(row.createdAt)),
            detail(
              'Mismatching settings',
              replicaMismatchNames(row.snapshot, policy.legacySnapshot, Boolean(row.differs))
            ),
            detail(
              'Observation',
              row.at.getTime() > snapshot.getTime() - 600000
                ? 'Active within ten minutes'
                : 'Historical; not evidence of current availability'
            ),
            detail(
              'Resolution',
              row.differs
                ? 'Compare canonical public URLs and legacy login settings across web replicas. Align deployment values and restart affected web replicas; the database policy remains authoritative.'
                : 'No mismatch was reported at this observation. This does not prove current IdP health.'
            ),
          ],
        }));
      } else {
        const state = Prisma.sql`CASE WHEN "cancelledAt" IS NOT NULL THEN 'CANCELLED' WHEN "deliveredAt" IS NOT NULL THEN 'DELIVERED' WHEN "failedAt" IS NOT NULL THEN 'FAILED' WHEN "acceptedAt" IS NOT NULL THEN 'ACCEPTED' ELSE 'PENDING' END`;
        rows = await tx.$queryRaw<
          Row[]
        >(Prisma.sql`SELECT * FROM (SELECT id,"createdAt","createdAt" AS at,title,"eventId","acceptedAt","deliveredAt","failedAt","cancelledAt",attempts,"lastError","deliveryGeneration","notificationId",${state} AS state FROM "AuthenticationAlert" WHERE "createdAt" <= ${to}
        ${from ? Prisma.sql`AND "createdAt" >= ${from}` : Prisma.empty}
        ${query.q ? Prisma.sql`AND (LOWER(title) LIKE ${prefix(query.q)} OR LOWER(id) LIKE ${prefix(query.q)})` : Prisma.empty}
        ) selected WHERE TRUE ${query.state !== 'all' ? Prisma.sql`AND state = ${query.state}` : Prisma.empty}
        ${boundary(Prisma.sql`"createdAt"`, cursor)} ORDER BY "createdAt" DESC,id DESC LIMIT ${query.pageSize + 1}`);
        const notificationIds = rows
          .slice(0, query.pageSize)
          .map(row => text(row.notificationId))
          .filter(Boolean);
        const notifications = notificationIds.length
          ? await tx.notification.findMany({
              where: { id: { in: notificationIds } },
              select: { id: true, deliveryProvider: true, attempts: true, lastAttemptAt: true },
            })
          : [];
        items = rows.slice(0, query.pageSize).map(row => {
          const notification = notifications.find(item => item.id === row.notificationId);
          return {
            id: row.id,
            title: text(row.title),
            subtitle: `Event ${text(row.eventId)}`,
            state: text(row.state),
            createdAt: iso(row.createdAt),
            activityAt:
              iso(row.deliveredAt) ||
              iso(row.failedAt) ||
              iso(row.cancelledAt) ||
              iso(row.acceptedAt) ||
              iso(row.createdAt),
            source: 'AuthenticationAlert · durable security email evidence',
            generation: Number(row.deliveryGeneration),
            canRetry: row.state === 'FAILED' && fresh,
            actionExplanation:
              row.state !== 'FAILED'
                ? 'Only failed deliveries are eligible for an explicit retry.'
                : !fresh
                  ? 'Authenticate again before retrying delivery.'
                  : 'A retry may deliver a duplicate if the earlier outcome was uncertain.',
            details: [
              detail('Provider', notification?.deliveryProvider ?? 'Not recorded'),
              detail('Alert attempts', row.attempts),
              detail('Provider attempts', notification?.attempts ?? 'Not recorded'),
              detail('Last attempt', iso(notification?.lastAttemptAt) || 'Not recorded'),
              detail('Last recorded error', row.lastError ?? 'None recorded'),
              detail('Event correlation identifier', row.eventId),
              detail('Delivery generation', row.deliveryGeneration),
            ],
            timeline: [
              { label: 'Queued', at: iso(row.createdAt) },
              ...(['acceptedAt', 'deliveredAt', 'failedAt', 'cancelledAt'] as const)
                // eslint-disable-next-line security/detect-object-injection -- Key is a closed, server-defined enum.
                .filter(key => row[key] instanceof Date)
                .map(key => ({
                  // eslint-disable-next-line security/detect-object-injection -- Key is a closed, server-defined enum.
                  label: {
                    acceptedAt: 'Provider accepted',
                    deliveredAt: 'Delivery confirmed',
                    failedAt: 'Failed',
                    cancelledAt: 'Cancelled',
                  }[key],
                  // eslint-disable-next-line security/detect-object-injection -- Key is a closed, server-defined enum.
                  at: iso(row[key]),
                })),
            ].sort((a, b) => a.at.localeCompare(b.at)),
          };
        });
      }
      return { rows, items };
    },
    { maxWait: 500, timeout: 2500 }
  );
  const hasMore = result.rows.length > query.pageSize;
  const last = result.rows[Math.min(query.pageSize, result.rows.length) - 1];
  return {
    items: result.items,
    hasMore,
    pageSize: query.pageSize,
    snapshotAt,
    nextCursor:
      hasMore && last
        ? await encodeDiagnosticCursor({
            v: 1,
            context,
            snapshotAt,
            at: last.at.toISOString(),
            id: last.id,
          })
        : null,
  };
}
