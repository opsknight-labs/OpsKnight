import 'server-only';
import prisma from '@/lib/prisma';
import { getClientIp, type HeaderSource } from '@/lib/client-ip';
import { isIpAllowed } from './ip-allow-list';

/**
 * Network gate for private pages. Uses the repo's trusted client-IP resolver, never a raw
 * X-Forwarded-For, and reads the live allow-list so a tightened list applies immediately.
 */
export async function isStatusPageIpAllowed(pageId: string, headers: HeaderSource) {
  const page = await prisma.statusPage.findUnique({
    where: { id: pageId },
    select: { ipAllowList: true },
  });
  return isIpAllowed(getClientIp(headers), page?.ipAllowList ?? []);
}
