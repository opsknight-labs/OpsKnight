const OVERDUE_STATUSES = ['OPEN', 'IN_PROGRESS', 'BLOCKED'] as const;
const PAGE_SIZE = 500;
// Bounds one run at 20,000 overdue items; the next day's run continues the reminders.
const MAX_PAGES = 40;
const UNOWNED_ENTITY_ID = 'unowned';

/**
 * Daily reminder for overdue postmortem action items: each owner is told once per 24 hours per
 * item. Pages through every overdue item (a fixed "oldest 500" would re-notify the same items and
 * starve the rest), and never fans out to administrators per item: items with no owner become a
 * single "unowned" notice per administrator.
 */
export async function notifyOverdueActionItems(now: Date): Promise<number> {
  const { default: prisma } = await import('./prisma');
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const overdue = { status: { in: [...OVERDUE_STATUSES] }, dueDate: { lt: now } };

  let created = 0;
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const items = await prisma.actionItem.findMany({
      where: { ...overdue, ownerId: { not: null } },
      select: { id: true, title: true, ownerId: true },
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (items.length === 0) break;
    cursor = items[items.length - 1]?.id;
    const existing = await prisma.inAppNotification.findMany({
      where: {
        entityType: 'ACTION_ITEM',
        entityId: { in: items.map(item => item.id) },
        createdAt: { gte: since },
      },
      select: { userId: true, entityId: true },
    });
    const existingKeys = new Set(existing.map(row => `${row.userId}:${row.entityId}`));
    const rows = items.flatMap(item =>
      item.ownerId && !existingKeys.has(`${item.ownerId}:${item.id}`)
        ? [
            {
              userId: item.ownerId,
              type: 'ACTION_ITEM' as const,
              title: 'Overdue postmortem action item',
              message: item.title,
              entityType: 'ACTION_ITEM',
              entityId: item.id,
            },
          ]
        : []
    );
    if (rows.length > 0)
      created += (await prisma.inAppNotification.createMany({ data: rows })).count;
    if (items.length < PAGE_SIZE) break;
  }

  const unowned = await prisma.actionItem.count({ where: { ...overdue, ownerId: null } });
  if (unowned > 0) {
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true },
    });
    const notified = await prisma.inAppNotification.findMany({
      where: {
        entityType: 'ACTION_ITEM',
        entityId: UNOWNED_ENTITY_ID,
        createdAt: { gte: since },
        userId: { in: admins.map(admin => admin.id) },
      },
      select: { userId: true },
    });
    const notifiedIds = new Set(notified.map(row => row.userId));
    const rows = admins
      .filter(admin => !notifiedIds.has(admin.id))
      .map(admin => ({
        userId: admin.id,
        type: 'ACTION_ITEM' as const,
        title: 'Overdue action items have no owner',
        message: `${unowned} overdue postmortem action item${unowned === 1 ? ' has' : 's have'} no owner. Assign them so they get done.`,
        entityType: 'ACTION_ITEM',
        entityId: UNOWNED_ENTITY_ID,
      }));
    if (rows.length > 0)
      created += (await prisma.inAppNotification.createMany({ data: rows })).count;
  }
  return created;
}
