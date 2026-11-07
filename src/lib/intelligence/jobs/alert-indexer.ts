import 'server-only';
import { createHash } from 'node:crypto';
import { Prisma, type IncidentFingerprint } from '@prisma/client';
import { INTELLIGENCE_ENGINE_VERSION } from '../contract';
import { buildIncidentFingerprint } from '../normalization';
import { canonicalizeLabels, MAX_LABELS, type CanonicalLabels } from '../normalization/labels';
import { stableAnalysisHash } from './input-hash';

type Tx = Prisma.TransactionClient;
type Cursor = { id: string; createdAt: Date };
type State = Pick<
  IncidentFingerprint,
  | 'lastIndexedAlertId'
  | 'lastIndexedAlertAt'
  | 'lastModifiedAlertId'
  | 'lastModifiedAlertAt'
  | 'alertInputDigest'
  | 'indexedAlertCount'
  | 'alertNormalizationHash'
>;
const PAGE_SIZE = 250;
/**
 * A full (re)build reads at most this many alert payloads per pass and then hands back a partial state. The
 * next pass resumes from the saved cursor, so a 100k-alert incident is bootstrapped over several bounded
 * transactions instead of one that can only ever exceed its budget and dead-letter.
 */
export const MAX_BOOTSTRAP_ALERTS_PER_PASS = 5_000;
const MAX_PAGES_PER_PASS = MAX_BOOTSTRAP_ALERTS_PER_PASS / PAGE_SIZE;
const EMPTY_DIGEST = createHash('sha256').update('opsknight-alert-inputs:v2').digest('hex');
const advance = (digest: string, sourceHash: string) =>
  createHash('sha256').update(digest).update(sourceHash).digest('hex');
const after = (a: Cursor, b: Cursor) =>
  +a.createdAt > +b.createdAt || (+a.createdAt === +b.createdAt && a.id > b.id);
const labelUnion = (into: Map<string, string>, labels: CanonicalLabels) => {
  for (const [key, value] of Object.entries(labels))
    if (!into.has(key) && into.size < MAX_LABELS) into.set(key, value);
};
const sortedLabels = (labels: Map<string, string>) =>
  Object.fromEntries([...labels.entries()].sort(([a], [b]) => a.localeCompare(b)));

export interface AlertInputs {
  digest: string;
  labels: CanonicalLabels;
  state: State;
  stateChanged: boolean;
  /** True when a bounded (re)build pass stopped early; the caller stores the state and re-signals itself. */
  partial: boolean;
}

/** Append-only ingestion reads/hashes only new alerts. ORM edits use a second cursor. Exceptional
 * edits/backdated arrivals rebuild the ordered digest from cached fingerprints, not raw payloads.
 * Count drift repairs deletions, missing derived rows and out-of-band historical inserts. Force and
 * normalization changes deliberately rebuild from source, in bounded passes. Caller holds the incident
 * fingerprint lock.
 */
export async function indexAlertInputs(
  tx: Tx,
  incident: { id: string; serviceId: string; title: string },
  previous: IncidentFingerprint | null,
  options: { force?: boolean; depth?: number } = {}
): Promise<AlertInputs> {
  const normalizationHash = stableAnalysisHash({
    title: incident.title,
    serviceId: incident.serviceId,
    engineVersion: INTELLIGENCE_ENGINE_VERSION,
  });
  // A partial bootstrap resumes where it stopped, whatever else was asked; its saved digest is only
  // meaningful under the same normalization.
  const resume = Boolean(
    previous?.alertIndexPartial &&
    previous.alertInputDigest &&
    previous.alertNormalizationHash === normalizationHash
  );
  const reset =
    resume ||
    Boolean(
      options.force ||
      !previous?.alertInputDigest ||
      previous.alertNormalizationHash !== normalizationHash ||
      previous.indexedAlertCount === null
    );
  const fresh = reset && !resume;
  const count = await tx.alert.count({ where: { incidentId: incident.id } });
  const tail = await tx.alert.findFirst({
    where: { incidentId: incident.id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, createdAt: true },
  });
  let digest = fresh ? EMPTY_DIGEST : previous!.alertInputDigest!;
  const labels = new Map<string, string>(
    fresh ? [] : Object.entries(canonicalizeLabels(previous!.labels))
  );
  let newest: Cursor | null =
    fresh || !previous?.lastIndexedAlertAt || !previous.lastIndexedAlertId
      ? null
      : { id: previous.lastIndexedAlertId, createdAt: previous.lastIndexedAlertAt };
  let modified: Cursor | null =
    fresh || !previous?.lastModifiedAlertAt || !previous.lastModifiedAlertId
      ? null
      : { id: previous.lastModifiedAlertId, createdAt: previous.lastModifiedAlertAt };
  const oldNewest = resume ? null : newest,
    oldModified = resume ? null : modified;
  // A resumed bootstrap continues after the last alert the previous pass hashed.
  let pageCursor: Cursor | undefined = resume && newest ? newest : undefined;
  let processed = resume ? (previous!.indexedAlertCount ?? 0) : 0;
  let pages = 0;
  let partial = false;
  let added = 0;
  let rebuildMetadata = false;
  for (;;) {
    if (!tail) break;
    const changes: Prisma.AlertWhereInput[] = [];
    if (!reset && oldNewest)
      changes.push(
        { createdAt: { gt: oldNewest.createdAt } },
        { createdAt: oldNewest.createdAt, id: { gt: oldNewest.id } }
      );
    if (!reset && oldModified)
      changes.push(
        { updatedAt: { gt: oldModified.createdAt } },
        { updatedAt: oldModified.createdAt, id: { gt: oldModified.id } }
      );
    if (!reset && !oldModified) changes.push({ updatedAt: { not: null } });
    const alerts = await tx.alert.findMany({
      where: {
        incidentId: incident.id,
        AND: [
          {
            OR: [
              { createdAt: { lt: tail.createdAt } },
              { createdAt: tail.createdAt, id: { lte: tail.id } },
            ],
          },
          ...(!reset && changes.length ? [{ OR: changes }] : []),
          ...(pageCursor
            ? [
                {
                  OR: [
                    { createdAt: { gt: pageCursor.createdAt } },
                    { createdAt: pageCursor.createdAt, id: { gt: pageCursor.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: PAGE_SIZE,
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        payload: true,
        status: true,
        severity: true,
        resourceKey: true,
        labels: true,
        fingerprintHash: true,
      },
    });
    const oldRows =
      reset || !alerts.length
        ? []
        : await tx.alertFingerprint.findMany({
            where: { alertId: { in: alerts.map(row => row.id) } },
            select: { alertId: true, sourceHash: true },
          });
    const old = new Map(oldRows.map(row => [row.alertId, row.sourceHash]));
    const rows: Prisma.Sql[] = [];
    for (const alert of alerts) {
      const payload = alert.payload as { custom_details?: unknown } | null;
      const extracted =
        alert.labels && typeof alert.labels === 'object' && !Array.isArray(alert.labels)
          ? canonicalizeLabels(alert.labels)
          : canonicalizeLabels(payload?.custom_details ?? payload);
      const content =
        payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
      const fingerprint = buildIncidentFingerprint({
        title: typeof content.summary === 'string' ? content.summary : incident.title,
        description: typeof content.description === 'string' ? content.description : null,
        labelSource: extracted,
      });
      const sourceHash = stableAnalysisHash({
        id: alert.id,
        payload: alert.payload,
        status: alert.status,
        createdAt: alert.createdAt.toISOString(),
        severity: alert.severity,
        resourceKey: alert.resourceKey,
        fingerprintHash: alert.fingerprintHash,
        template: fingerprint.template,
        labels: extracted,
        engineVersion: INTELLIGENCE_ENGINE_VERSION,
      });
      if (reset) {
        digest = advance(digest, sourceHash);
        labelUnion(labels, extracted);
        processed += 1;
      } else if (!old.has(alert.id)) {
        added++;
        if (oldNewest && !after(alert, oldNewest)) rebuildMetadata = true;
        digest = advance(digest, sourceHash);
        labelUnion(labels, extracted);
      } else if (old.get(alert.id) !== sourceHash) rebuildMetadata = true;
      if (!newest || after(alert, newest)) newest = alert;
      if (alert.updatedAt) {
        const changed = { id: alert.id, createdAt: alert.updatedAt };
        if (!modified || after(changed, modified)) modified = changed;
      }
      rows.push(Prisma.sql`(${alert.id}, ${incident.id}, ${incident.serviceId}, ${fingerprint.template},
        ${fingerprint.template ? createHash('sha256').update(fingerprint.template).digest('hex').slice(0, 32) : null},
        ${fingerprint.tokens}::text[], ${JSON.stringify(extracted)}::jsonb, ${sourceHash},
        ${INTELLIGENCE_ENGINE_VERSION}, ${alert.createdAt}, now())`);
    }
    if (rows.length)
      await tx.$executeRaw(Prisma.sql`
      INSERT INTO "AlertFingerprint" ("alertId", "incidentId", "serviceId", "template", "templateHash", "tokens", "labels", "sourceHash", "engineVersion", "alertCreatedAt", "updatedAt")
      VALUES ${Prisma.join(rows)} ON CONFLICT ("alertId") DO UPDATE SET
        "incidentId" = EXCLUDED."incidentId", "serviceId" = EXCLUDED."serviceId",
        "template" = EXCLUDED.template, "templateHash" = EXCLUDED."templateHash", tokens = EXCLUDED.tokens,
        labels = EXCLUDED.labels, "sourceHash" = EXCLUDED."sourceHash", "engineVersion" = EXCLUDED."engineVersion",
        "alertCreatedAt" = EXCLUDED."alertCreatedAt", "updatedAt" = now()
      WHERE "AlertFingerprint"."sourceHash" IS DISTINCT FROM EXCLUDED."sourceHash"
        OR "AlertFingerprint"."incidentId" <> EXCLUDED."incidentId"
        OR "AlertFingerprint"."serviceId" <> EXCLUDED."serviceId"
        OR "AlertFingerprint"."alertCreatedAt" <> EXCLUDED."alertCreatedAt"`);
    if (alerts.length < PAGE_SIZE) break;
    pageCursor = alerts[alerts.length - 1];
    pages += 1;
    if (reset && pages >= MAX_PAGES_PER_PASS) {
      partial = true;
      break;
    }
  }
  if (partial) {
    return {
      digest,
      labels: sortedLabels(labels),
      state: {
        lastIndexedAlertId: newest?.id ?? null,
        lastIndexedAlertAt: newest?.createdAt ?? null,
        lastModifiedAlertId: modified?.id ?? null,
        lastModifiedAlertAt: modified?.createdAt ?? null,
        alertInputDigest: digest,
        indexedAlertCount: processed,
        alertNormalizationHash: normalizationHash,
      },
      stateChanged: true,
      partial: true,
    };
  }
  if (!reset && previous!.indexedAlertCount! + added !== count) rebuildMetadata = true;
  if (reset || rebuildMetadata)
    await tx.alertFingerprint.deleteMany({
      where: {
        incidentId: incident.id,
        alert: { OR: [{ incidentId: null }, { incidentId: { not: incident.id } }] },
      },
    });
  const indexedCount = await tx.alertFingerprint.count({ where: { incidentId: incident.id } });
  // Count drift means rows were deleted or inserted out of band: rebuild once from source, never recursively.
  if (!reset && indexedCount !== count && (options.depth ?? 0) === 0)
    return indexAlertInputs(tx, incident, previous, { force: true, depth: 1 });
  if (!reset && rebuildMetadata) {
    digest = EMPTY_DIGEST;
    labels.clear();
    let cursor: { id: string; createdAt: Date } | undefined;
    for (;;) {
      const cached = await tx.alertFingerprint.findMany({
        where: {
          incidentId: incident.id,
          ...(cursor
            ? {
                OR: [
                  { alertCreatedAt: { gt: cursor.createdAt } },
                  { alertCreatedAt: cursor.createdAt, alertId: { gt: cursor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ alertCreatedAt: 'asc' }, { alertId: 'asc' }],
        take: PAGE_SIZE,
        select: { alertId: true, alertCreatedAt: true, sourceHash: true, labels: true },
      });
      for (const row of cached) {
        digest = advance(digest, row.sourceHash);
        labelUnion(labels, canonicalizeLabels(row.labels));
      }
      if (cached.length < PAGE_SIZE) break;
      const last = cached[cached.length - 1];
      cursor = { id: last.alertId, createdAt: last.alertCreatedAt };
    }
  }
  const state: State = {
    lastIndexedAlertId: newest?.id ?? null,
    lastIndexedAlertAt: newest?.createdAt ?? null,
    lastModifiedAlertId: modified?.id ?? null,
    lastModifiedAlertAt: modified?.createdAt ?? null,
    alertInputDigest: digest,
    indexedAlertCount: indexedCount,
    alertNormalizationHash: normalizationHash,
  };
  const stateChanged =
    Boolean(previous?.alertIndexPartial) ||
    Object.entries(state).some(([key, value]) => {
      const oldValue: unknown = previous ? Reflect.get(previous, key) : undefined;
      return value instanceof Date
        ? !(oldValue instanceof Date) || +value !== +oldValue
        : value !== oldValue;
    });
  return { digest, labels: sortedLabels(labels), state, stateChanged, partial: false };
}
