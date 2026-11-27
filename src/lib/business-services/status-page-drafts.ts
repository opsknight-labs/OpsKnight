import { createHash } from 'node:crypto';
import prisma from '@/lib/prisma';
import { emitAuditEvent } from '@/lib/audit';
import { createAnnouncementFanoutJob } from '@/lib/status-pages/announcement-commands';

/** Ids of announcements drafted from a business-service status change start with this. */
export const AUTO_DRAFT_ID_PREFIX = 'bsd_';
const IMPACTED = new Set(['DEGRADED', 'PARTIAL_OUTAGE', 'MAJOR_OUTAGE']);
const IMPACT_PHRASE: Record<string, string> = {
  DEGRADED: 'degraded performance',
  PARTIAL_OUTAGE: 'a partial outage',
  MAJOR_OUTAGE: 'a major outage',
};

export type StatusDraftKind = 'IMPACT' | 'RECOVERY';

/** Impact starts when a healthy service turns impacted; recovery when an impacted one is operational again. */
export function statusDraftKind(from: string, to: string): StatusDraftKind | null {
  if (!IMPACTED.has(from) && IMPACTED.has(to)) return 'IMPACT';
  if (IMPACTED.has(from) && to === 'OPERATIONAL') return 'RECOVERY';
  return null;
}

/** Public-safe wording: names only what the page shows, never incident internals. */
export function statusDraftText(kind: StatusDraftKind, name: string, to: string) {
  if (kind === 'RECOVERY')
    return {
      type: 'UPDATE' as const,
      title: `${name} has recovered`,
      message: `${name} is operating normally again. Thank you for your patience.`,
    };
  // eslint-disable-next-line security/detect-object-injection -- `to` is a closed health status
  const phrase = IMPACT_PHRASE[to] ?? 'an issue';
  return {
    type: to === 'DEGRADED' ? ('WARNING' as const) : ('INCIDENT' as const),
    title: `${name}: ${phrase.replace(/^an? /, '')}`,
    message: `We are investigating ${phrase} affecting ${name}. We will post an update as we learn more.`,
  };
}

/** Deterministic per (transition, page): a retried reconcile finds the row it already wrote. */
export function statusDraftId(changeKey: string, statusPageId: string): string {
  return `${AUTO_DRAFT_ID_PREFIX}${createHash('sha256')
    .update(`${changeKey}:${statusPageId}`)
    .digest('hex')
    .slice(0, 24)}`;
}

/**
 * When a business service shown on status pages becomes impacted or recovers, writes one
 * announcement per page: a draft (`isActive: false`) an admin reviews and publishes from the
 * announcement manager (the normal publish path and its subscriber fan-out), or, when the
 * business service opted in to auto-publish, a published update with its fan-out job.
 * Each write is audited. Idempotent under at-least-once reconcile.
 */
export async function draftStatusPageUpdates(input: {
  businessService: { id: string; name: string; autoPublishStatusUpdates: boolean };
  pages: ReadonlyArray<{ statusPageId: string; displayName?: string | null }>;
  from: string;
  to: string;
  changeKey: string;
  now?: Date;
}): Promise<number> {
  const kind = statusDraftKind(input.from, input.to);
  if (!kind) return 0;
  const now = input.now ?? new Date();
  const bs = input.businessService;
  let written = 0;
  for (const page of input.pages) {
    const id = statusDraftId(input.changeKey, page.statusPageId);
    const text = statusDraftText(kind, page.displayName?.trim() || bs.name, input.to);
    const publish = bs.autoPublishStatusUpdates;
    const created = await prisma.$transaction(async tx => {
      if (await tx.statusPageAnnouncement.findUnique({ where: { id }, select: { id: true } }))
        return false;
      // An impact draft nobody published is stale once the service recovers.
      const withdrawn =
        kind === 'RECOVERY'
          ? await tx.statusPageAnnouncement.deleteMany({
              where: {
                statusPageId: page.statusPageId,
                id: { startsWith: AUTO_DRAFT_ID_PREFIX },
                isActive: false,
                affectedBusinessServiceIds: { array_contains: [bs.id] },
              },
            })
          : { count: 0 };
      // A published recovery also ends the published impact notice: otherwise the page kept
      // saying "We are investigating" after the recovery (which ends at once and never shows).
      const closed =
        kind === 'RECOVERY' && publish
          ? await tx.statusPageAnnouncement.updateMany({
              where: {
                statusPageId: page.statusPageId,
                id: { startsWith: AUTO_DRAFT_ID_PREFIX },
                isActive: true,
                endDate: null,
                affectedBusinessServiceIds: { array_contains: [bs.id] },
              },
              data: { endDate: now },
            })
          : { count: 0 };
      const announcement = await tx.statusPageAnnouncement.create({
        data: {
          id,
          statusPageId: page.statusPageId,
          ...text,
          startDate: now,
          endDate: kind === 'RECOVERY' ? now : null,
          publishAt: now,
          notificationTiming: 'ON_PUBLISH',
          isActive: publish,
          affectedBusinessServiceIds: [bs.id],
        },
        select: { id: true, notificationGeneration: true },
      });
      if (publish)
        await createAnnouncementFanoutJob(tx, {
          announcementId: announcement.id,
          statusPageId: page.statusPageId,
          scheduledAt: now,
          generation: announcement.notificationGeneration,
          deliveryMode: 'ALL_ELIGIBLE',
        });
      await emitAuditEvent(
        {
          action: publish
            ? 'status_page.announcement.auto_published'
            : 'status_page.announcement.auto_drafted',
          source: 'SYSTEM',
          actor: { type: 'SYSTEM' },
          target: { type: 'STATUS_PAGE', id: page.statusPageId },
          metadata: {
            announcementId: id,
            businessServiceId: bs.id,
            kind,
            from: input.from,
            to: input.to,
            withdrawnDrafts: withdrawn.count,
            closedNotices: closed.count,
          },
        },
        tx
      );
      return true;
    });
    if (created) written += 1;
  }
  return written;
}
