'use server';

import { promises as dns } from 'node:dns';
import prisma from '@/lib/prisma';
import { getAppUrl } from '@/lib/app-config';
import { emitAuditEvent } from '@/lib/audit';
import { checkRateLimit } from '@/lib/rate-limit';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { AUTHORIZATION_ACTIONS, authorize } from '@/lib/authorization-policy';
import {
  isCheckableHostname,
  mapDomainDnsResult,
  type DomainDnsResult,
} from '@/lib/status-pages/domain-dns';

export type CheckDomainDnsResponse = { result: DomainDnsResult } | { error: string };

const lookup = async <T>(run: () => Promise<T[]>): Promise<T[]> => {
  try {
    return await run();
  } catch {
    return []; // NXDOMAIN / NODATA / timeout all read as "not there yet".
  }
};

/** DNS-only (no HTTP fetch, so no SSRF surface) check of a page's saved custom domain. */
export async function checkCustomDomainDnsAction(pageId: string): Promise<CheckDomainDnsResponse> {
  const actor = await getCurrentAuthorizationActor();
  if (!authorize({ actor, action: AUTHORIZATION_ACTIONS.STATUS_PAGE_MANAGE }).allowed)
    return { error: 'You do not have permission to manage this status page.' };
  const limit = await checkRateLimit(`status-domain-dns:${actor.id}`, 10, 60_000);
  if (!limit.allowed) return { error: 'Too many checks. Try again in a minute.' };
  const page = await prisma.statusPage.findUnique({
    where: { id: pageId },
    select: { customDomain: true },
  });
  const domain = page?.customDomain?.trim();
  if (!domain) return { error: 'Save a custom domain first.' };
  if (!isCheckableHostname(domain)) return { error: 'This hostname cannot be verified.' };
  let appHost: string;
  try {
    appHost = new URL(await getAppUrl()).hostname;
  } catch {
    return { error: 'The application URL is not configured.' };
  }
  const [cname, a, aaaa, appA, appAaaa] = await Promise.all([
    lookup(() => dns.resolveCname(domain)),
    lookup(() => dns.resolve4(domain)),
    lookup(() => dns.resolve6(domain)),
    lookup(() => dns.resolve4(appHost)),
    lookup(() => dns.resolve6(appHost)),
  ]);
  const result = mapDomainDnsResult({
    domain,
    appHost,
    cname,
    addresses: [...a, ...aaaa],
    appAddresses: [...appA, ...appAaaa],
  });
  await emitAuditEvent({
    action: 'status_page.domain_dns_checked',
    source: 'UI',
    target: { type: 'STATUS_PAGE', id: pageId },
    actor: { type: 'USER', id: actor.id },
    newValue: { domain, state: result.state },
  });
  return { result };
}
