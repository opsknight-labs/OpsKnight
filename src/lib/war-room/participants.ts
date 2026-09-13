import 'server-only';

import prisma from '@/lib/prisma';

/**
 * Projects OpsKnight responders into durable provider-neutral desired members.
 * Linking is intentionally fail-closed: an unlinked responder is recorded as
 * SKIPPED, never looked up through a directory/email fallback.
 */
export async function projectMicrosoftTeamsWarRoomParticipants(warRoomId: string): Promise<void> {
  const room = await prisma.incidentWarRoom.findUnique({
    where: { id: warRoomId },
    include: { incident: { select: { assigneeId: true, watchers: { select: { userId: true } } } } },
  });
  if (!room || room.provider !== 'MICROSOFT_TEAMS' || !room.providerTenantId) return;
  const responders = new Map<string, 'ASSIGNEE' | 'WATCHER'>();
  if (room.incident.assigneeId) responders.set(room.incident.assigneeId, 'ASSIGNEE');
  for (const watcher of room.incident.watchers) if (!responders.has(watcher.userId)) responders.set(watcher.userId, 'WATCHER');
  if (responders.size === 0) return;
  const links = await prisma.chatIdentityLink.findMany({
    where: { provider: 'MICROSOFT_TEAMS', providerTenantId: room.providerTenantId, revokedAt: null, userId: { in: [...responders.keys()] } },
    select: { userId: true, providerUserId: true, providerObjectId: true },
  });
  const byUser = new Map(links.map(link => [link.userId, link]));
  await prisma.$transaction(async tx => {
    for (const [userId, source] of responders) {
    const link = byUser.get(userId);
    const data = { source, providerUserId: link?.providerUserId ?? null, providerObjectId: link?.providerObjectId ?? null, state: link ? 'DESIRED' as const : 'SKIPPED' as const, lastError: link ? null : 'IDENTITY_NOT_LINKED' };
    const existing = await tx.warRoomParticipant.findFirst({ where: { warRoomId, userId } });
    if (existing) await tx.warRoomParticipant.update({ where: { id: existing.id }, data });
    else await tx.warRoomParticipant.create({ data: { warRoomId, userId, ...data } });
    }
  });
}
