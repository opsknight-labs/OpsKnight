import type { Prisma } from '@prisma/client';

/**
 * Keeps the `viaBusinessService` rows of every page that maps a business service in step with
 * the business services on that page: missing member rows are added, and rows whose service no
 * longer belongs to any business service on the page are removed. Directly selected services
 * (`viaBusinessService: false`) never move. Row changes dirty the page snapshot by trigger.
 *
 * Pass `deleting: true` BEFORE deleting the business service, so it is not counted as cover.
 */
export async function reconcileBusinessServicePublication(
  tx: Prisma.TransactionClient,
  businessServiceId: string,
  options: { deleting?: boolean } = {}
) {
  const pages = await tx.statusPageBusinessService.findMany({
    where: { businessServiceId },
    select: { statusPageId: true },
  });
  for (const { statusPageId } of pages) {
    const covered = new Set(
      (
        await tx.businessServiceMember.findMany({
          where: {
            businessService: {
              statusPages: { some: { statusPageId } },
              ...(options.deleting ? { id: { not: businessServiceId } } : {}),
            },
          },
          select: { serviceId: true },
        })
      ).map(member => member.serviceId)
    );
    const present = await tx.statusPageService.findMany({
      where: { statusPageId },
      select: { id: true, serviceId: true, viaBusinessService: true },
    });
    const orphaned = present.filter(row => row.viaBusinessService && !covered.has(row.serviceId));
    if (orphaned.length)
      await tx.statusPageService.deleteMany({ where: { id: { in: orphaned.map(row => row.id) } } });
    const have = new Set(present.map(row => row.serviceId));
    const missing = [...covered].filter(serviceId => !have.has(serviceId));
    if (missing.length)
      await tx.statusPageService.createMany({
        data: missing.map(serviceId => ({ statusPageId, serviceId, viaBusinessService: true })),
        skipDuplicates: true,
      });
  }
  // Deleting the mapping rows by cascade also dirties the page (trigger); nothing more to do.
}
