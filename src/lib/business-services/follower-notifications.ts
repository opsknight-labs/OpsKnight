import prisma from '@/lib/prisma';
import { createInAppNotifications } from '@/lib/in-app-notifications';
import { filterWatchersByCadence } from '@/lib/user-notifications';

type FollowerEvent = 'triggered' | 'acknowledged' | 'resolved' | 'updated';

/** Plain language for people who care about the capability, not the component. */
export function businessServiceUpdateText(
  names: readonly string[],
  eventType: FollowerEvent
): { title: string; message: string } {
  const subject =
    names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and others`;
  const plural = names.length > 1;
  switch (eventType) {
    case 'resolved':
      return {
        title: `${subject} ${plural ? 'are' : 'is'} back to normal`,
        message: 'The issue affecting it has been resolved.',
      };
    case 'acknowledged':
      return {
        title: `${subject}: a team is working on it`,
        message: 'Responders have picked up the issue and are investigating.',
      };
    default:
      return {
        title: `${subject} ${plural ? 'are' : 'is'} affected`,
        message: 'Something is wrong and responders have been alerted.',
      };
  }
}

/**
 * Followers of a business service hear about public incidents on its member services in plain
 * language, at stakeholder cadence (start, pickup, resolution), in the app only: never paged.
 */
export async function notifyBusinessServiceFollowers(input: {
  incident: {
    id: string;
    serviceId: string;
    visibility?: string | null;
    priority?: string | null;
    urgency?: string | null;
  };
  eventType: FollowerEvent;
  excludeUserIds?: readonly string[];
}): Promise<number> {
  if (input.incident.visibility && input.incident.visibility !== 'PUBLIC') return 0;
  const groups = await prisma.businessService.findMany({
    where: {
      members: { some: { serviceId: input.incident.serviceId } },
      followers: { some: {} },
    },
    select: { name: true, followers: { select: { userId: true } } },
    orderBy: { name: 'asc' },
  });
  if (!groups.length) return 0;
  const exclude = new Set(input.excludeUserIds ?? []);
  const namesByUser = new Map<string, string[]>();
  for (const group of groups) {
    const userIds = filterWatchersByCadence(
      group.followers.map(follower => ({ userId: follower.userId, role: 'STAKEHOLDER' })),
      input.eventType,
      input.incident
    );
    for (const userId of userIds) {
      if (exclude.has(userId)) continue;
      namesByUser.set(userId, [...(namesByUser.get(userId) ?? []), group.name]);
    }
  }
  // One message per distinct set of business services, so wording stays exact per person.
  const byText = new Map<string, string[]>();
  for (const [userId, names] of namesByUser) {
    const key = JSON.stringify(names);
    byText.set(key, [...(byText.get(key) ?? []), userId]);
  }
  for (const [key, userIds] of byText) {
    const text = businessServiceUpdateText(JSON.parse(key) as string[], input.eventType);
    await createInAppNotifications({
      userIds,
      type: 'INCIDENT',
      title: text.title,
      message: text.message,
      entityType: 'INCIDENT',
      entityId: input.incident.id,
      dedupeKey: `business-service:${input.incident.id}:${input.eventType}:${key}`,
    });
  }
  return namesByUser.size;
}
