import 'server-only';
import { z } from 'zod/v4';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { resolveUserActor } from '@/lib/authorization-actors';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { createInAppNotifications } from '@/lib/in-app-notifications';
import { publishSquireUpdate } from '@/lib/chatops/squire/publish';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';
import { withDbBudget, dbNow } from '../jobs/db-budget';
import { enqueueWorkItems, WORK_KINDS } from '../jobs/work-queue';
import { resolveEffectivePolicy } from '../settings/service';
import { PROACTIVE_LIMITS } from './contract';
import { writeProactiveNote, type ProactiveOutcome } from './proactive';

/**
 * "Did the fix hold?": after a person resolves an incident or starts a runbook
 * through Squire, the lane checks `verificationDelayMs` later for new alerts and incidents on the same service
 * (matched on dedup key or fingerprint where the incident has them) and writes a VERIFICATION note. Deterministic,
 * so it runs without AI. Only the person who confirmed the fix is notified, and only of what they may read.
 */

export type FixTrigger = 'RESOLVE' | 'RUNBOOK';

const PREFIX = 'VERIFICATION:';
const SUBJECT = /^VERIFICATION:([A-Za-z0-9_-]{1,64}):([A-Za-z0-9_-]{1,64}):(\d{10,16}):([RB])$/;

export const isVerificationSubject = (subject: string) => subject.startsWith(PREFIX);

/** One work item per confirmed fix: incident, confirming person, time and trigger. */
export const verificationSubject = (
  incidentId: string,
  userId: string,
  at: Date,
  trigger: FixTrigger
) => `${PREFIX}${incidentId}:${userId}:${at.getTime()}:${trigger === 'RESOLVE' ? 'R' : 'B'}`;

export function parseVerificationSubject(subject: string) {
  const match = SUBJECT.exec(subject);
  return match
    ? {
        incidentId: match[1],
        userId: match[2],
        at: new Date(Number(match[3])),
        trigger: (match[4] === 'R' ? 'RESOLVE' : 'RUNBOOK') as FixTrigger,
      }
    : null;
}

/**
 * Schedules the check. Never throws: a confirmed fix has already happened, and a missed check is only a
 * missed note.
 */
export async function scheduleFixVerification(input: {
  incidentId: string;
  userId: string;
  trigger: FixTrigger;
}): Promise<void> {
  try {
    const at = new Date();
    await enqueueWorkItems([
      {
        kind: WORK_KINDS.SQUIRE_PROACTIVE,
        subjectKey: verificationSubject(input.incidentId, input.userId, at, input.trigger),
        scheduledAt: new Date(at.getTime() + PROACTIVE_LIMITS.verificationDelayMs),
      },
    ]);
  } catch (error) {
    logger.warn('[Squire] Could not schedule the fix check', {
      error: error instanceof Error ? error.name : 'error',
    });
  }
}

const ref = z
  .object({
    id: z.string().max(64),
    label: z.string().max(300),
    status: z.string().max(32),
    /** New matching alerts grouped into this incident since the fix. */
    alerts: z.number().int().min(0),
    /** Opened after the fix (otherwise an existing incident that took new alerts). */
    opened: z.boolean(),
  })
  .strict();

export const verificationContentSchema = z
  .object({
    v: z.literal(1),
    trigger: z.enum(['RESOLVE', 'RUNBOOK']),
    confirmedBy: z.string().max(64),
    since: z.string().max(40),
    checkedAt: z.string().max(40),
    windowMinutes: z.number().int().min(0),
    holding: z.boolean(),
    /** Resolve only: the incident is open again. */
    reopened: z.boolean(),
    /** New alerts on this incident itself. */
    newAlerts: z.number().int().min(0),
    matchedOn: z.enum(['DEDUP', 'SERVICE']),
    /** Other incidents on the service with new matching activity; shown to a viewer only if readable. */
    related: z.array(ref).max(PROACTIVE_LIMITS.maxListItems),
    /** Matching alerts on the service not grouped into any incident. */
    unlinkedAlerts: z.number().int().min(0),
  })
  .strict();
export type VerificationContent = z.infer<typeof verificationContentSchema>;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** The verdict in one line, from facts the reader may see (`related` already filtered for them). */
export function verificationHeadline(content: VerificationContent): string {
  const window = plural(content.windowMinutes, 'minute');
  // A runbook check is measured from its start (its completion is not recorded), so the text says so.
  if (content.holding)
    return `Holding: no new alerts in ${window}${content.trigger === 'RUNBOOK' ? ' since the runbook started' : ''}.`;
  const verb = content.trigger === 'RESOLVE' ? 'resolve' : 'the runbook started';
  const alerts =
    content.newAlerts +
    content.unlinkedAlerts +
    content.related.reduce((sum, item) => sum + item.alerts, 0);
  const parts = [
    alerts ? `${plural(alerts, 'new alert')} since ${verb}` : '',
    content.reopened ? 'the incident reopened' : '',
    ...content.related
      .filter(item => item.opened)
      .map(item => `new incident "${item.label.slice(0, 120)}"`),
  ].filter(Boolean);
  return `Not holding: ${parts.join(', ') || `new activity on the service since ${verb}`}.`;
}

/** Runs one check. Idempotent: the note is generation-fenced and the notification carries the item's key. */
export async function runVerificationJob(
  subject: string,
  generation: number,
  budget: { maxDbMs: number }
): Promise<ProactiveOutcome> {
  const parsed = parseVerificationSubject(subject);
  if (!parsed) return 'skipped';
  const { incidentId, userId, at: since, trigger } = parsed;

  const checked = await withDbBudget(budget, async tx => {
    const incident = await tx.incident.findUnique({
      where: { id: incidentId },
      select: {
        id: true,
        title: true,
        status: true,
        serviceId: true,
        dedupKey: true,
        alerts: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: { dedupKey: true, fingerprintHash: true },
        },
      },
    });
    if (!incident) return null;
    const existing = await tx.squireProactiveNote.findUnique({
      where: { incidentId_kind: { incidentId, kind: 'VERIFICATION' } },
      select: { generation: true },
    });
    if (existing && existing.generation >= generation) return { stale: true as const };
    const now = await dbNow(tx);
    const keys = [
      ...new Set(
        [incident.dedupKey, ...incident.alerts.map(alert => alert.dedupKey)].filter(
          (key): key is string => Boolean(key)
        )
      ),
    ];
    const hashes = [
      ...new Set(
        incident.alerts
          .map(alert => alert.fingerprintHash)
          .filter((hash): hash is string => Boolean(hash))
      ),
    ];
    // Same dedup key or fingerprint where the incident has them; otherwise anything new on the service.
    const match: Prisma.AlertWhereInput =
      keys.length || hashes.length
        ? {
            OR: [
              ...(keys.length ? [{ dedupKey: { in: keys } }] : []),
              ...(hashes.length ? [{ fingerprintHash: { in: hashes } }] : []),
            ],
          }
        : {};
    const after = { gt: since };
    const [newAlerts, otherAlerts, opened] = await Promise.all([
      tx.alert.count({ where: { incidentId, createdAt: after } }),
      tx.alert.findMany({
        where: {
          AND: [
            { serviceId: incident.serviceId, createdAt: after },
            { OR: [{ incidentId: null }, { incidentId: { not: incidentId } }] },
            match,
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: 500,
        select: { incidentId: true },
      }),
      tx.incident.findMany({
        where: {
          serviceId: incident.serviceId,
          id: { not: incidentId },
          createdAt: after,
          ...(keys.length || hashes.length
            ? {
                OR: [
                  ...(keys.length ? [{ dedupKey: { in: keys } }] : []),
                  { alerts: { some: match } },
                ],
              }
            : {}),
        },
        orderBy: { createdAt: 'asc' },
        take: PROACTIVE_LIMITS.maxListItems,
        select: { id: true },
      }),
    ]);
    const perIncident = new Map<string, number>();
    let unlinkedAlerts = 0;
    for (const alert of otherAlerts)
      if (alert.incidentId)
        perIncident.set(alert.incidentId, (perIncident.get(alert.incidentId) ?? 0) + 1);
      else unlinkedAlerts += 1;
    const openedIds = new Set(opened.map(row => row.id));
    const relatedIds = [...new Set([...openedIds, ...perIncident.keys()])].slice(
      0,
      PROACTIVE_LIMITS.maxListItems
    );
    const rows = relatedIds.length
      ? await tx.incident.findMany({
          where: { id: { in: relatedIds } },
          select: { id: true, title: true, status: true },
        })
      : [];
    const reopened = trigger === 'RESOLVE' && incident.status !== 'RESOLVED';
    const related = rows.map(row => ({
      id: row.id,
      label: row.title.slice(0, 300),
      status: row.status,
      alerts: perIncident.get(row.id) ?? 0,
      opened: openedIds.has(row.id),
    }));
    const content: VerificationContent = {
      v: 1,
      trigger,
      confirmedBy: userId,
      since: since.toISOString(),
      checkedAt: now.toISOString(),
      windowMinutes: Math.max(0, Math.round((now.getTime() - since.getTime()) / 60_000)),
      holding: !reopened && newAlerts === 0 && related.length === 0 && unlinkedAlerts === 0,
      reopened,
      newAlerts,
      matchedOn: keys.length || hashes.length ? 'DEDUP' : 'SERVICE',
      related,
      unlinkedAlerts,
    };
    return { incident, content };
  });
  if (!checked) return 'skipped';
  if ('stale' in checked) return 'stale';
  const { incident, content } = checked;
  if ((await resolveEffectivePolicy(incident.serviceId)).effectiveMode === 'OFF') return 'off';

  const written = await withDbBudget(budget, tx =>
    writeProactiveNote(tx, {
      incidentId,
      kind: 'VERIFICATION',
      generation,
      mode: 'BASIC',
      model: null,
      content: content as unknown as Prisma.InputJsonValue,
    })
  );
  if (!written) return 'stale';
  addOperationalMetric('opsknight_squire_proactive_notes_total', 1, {
    kind: 'VERIFICATION',
    mode: 'BASIC',
  });

  // The channel gets counts about this incident only, never other incidents' titles.
  await publishSquireUpdate({
    incidentId,
    kind: 'VERIFICATION',
    title: content.holding ? 'The fix is holding' : 'The fix may not be holding',
    markdown: verificationHeadline({
      ...content,
      related: content.related.map(item => ({ ...item, label: 'on this service', opened: false })),
    }),
  });
  if (!content.holding) await notifyConfirmer(subject, incident, content);
  return 'written';
}

/** In-app notice to the person who confirmed the fix, built only from what they may read now. */
async function notifyConfirmer(
  subject: string,
  incident: { id: string; title: string },
  content: VerificationContent
): Promise<void> {
  try {
    const actor = await resolveUserActor(content.confirmedBy);
    if (!actor || actor.status !== 'ACTIVE') return;
    const readable = incidentReadWhere(actor);
    const ids = [incident.id, ...content.related.map(item => item.id)];
    const visible = new Set(
      (
        await prisma.incident.findMany({
          where: { AND: [{ id: { in: ids } }, readable] },
          select: { id: true },
        })
      ).map(row => row.id)
    );
    if (!visible.has(incident.id)) return;
    const related = content.related.filter(item => visible.has(item.id));
    // Alerts grouped into incidents they cannot open are left out of the count.
    const headline = verificationHeadline({ ...content, related });
    await createInAppNotifications({
      userIds: [content.confirmedBy],
      type: 'INCIDENT',
      title: 'The fix may not be holding',
      message: `${incident.title.slice(0, 200)}: ${headline}`.slice(0, 500),
      entityType: 'INCIDENT',
      entityId: incident.id,
      dedupeKey: subject,
    });
  } catch (error) {
    logger.warn('[Squire] Could not notify about the fix check', {
      error: error instanceof Error ? error.name : 'error',
    });
  }
}
