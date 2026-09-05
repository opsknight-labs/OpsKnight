import prisma from './prisma';

const FEED_TTL_MS = 2_000;
const CURSOR_LOOKBACK_MS = 30_000;
const USER_VERSION_RETENTION_MS = 5 * 60_000;
const FEED_BATCH_SIZE = 2_000;
const MAX_PAGES_PER_REFRESH = 5;

type Cursor = { createdAt: Date; id: string };
type UserVersion = { generation: number; seenAt: number };

let cursor: Cursor = { createdAt: new Date(Date.now() - CURSOR_LOOKBACK_MS), id: '' };
let generation = 0;
let expiresAt = 0;
let inFlight: Promise<void> | null = null;
const userVersions = new Map<string, UserVersion>();

async function refreshChangedUsers(): Promise<void> {
  const now = Date.now();
  if (expiresAt > now) return;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    let caughtUp = false;
    for (let page = 0; page < MAX_PAGES_PER_REFRESH; page += 1) {
      const rows = await prisma.inAppNotification.findMany({
        where: {
          OR: [
            { createdAt: { gt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { gt: cursor.id } },
          ],
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: FEED_BATCH_SIZE,
        select: { userId: true, createdAt: true, id: true },
      });
      if (rows.length === 0) {
        caughtUp = true;
        break;
      }

      generation += 1;
      const observedAt = Date.now();
      for (const row of rows) {
        userVersions.set(row.userId, { generation, seenAt: observedAt });
      }
      const last = rows[rows.length - 1];
      cursor = { createdAt: last.createdAt, id: last.id };
      if (rows.length < FEED_BATCH_SIZE) {
        caughtUp = true;
        break;
      }
    }

    const retentionCutoff = Date.now() - USER_VERSION_RETENTION_MS;
    for (const [userId, version] of userVersions) {
      if (version.seenAt < retentionCutoff) userVersions.delete(userId);
    }
    // A safety-bounded refresh that is still behind should be eligible to
    // continue immediately instead of sleeping for the normal idle TTL.
    expiresAt = caughtUp ? Date.now() + FEED_TTL_MS : 0;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/** A shared cursor wakes only streams whose user received a notification. */
export async function getNotificationUserChangeVersion(userId: string): Promise<number> {
  await refreshChangedUsers();
  return userVersions.get(userId)?.generation ?? 0;
}

export function clearNotificationChangeClock(now = Date.now()): void {
  cursor = { createdAt: new Date(now - CURSOR_LOOKBACK_MS), id: '' };
  generation = 0;
  expiresAt = 0;
  inFlight = null;
  userVersions.clear();
}
