import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getAppUrl } from '@/lib/app-config';
import {
  normalizeHostname,
  parseHostname,
  matchesStatusPageDomain,
  extractSubdomainFromHost,
} from '@/lib/status-pages/status-route-resolver';

export type StatusPageIdentity =
  | { id: string }
  | { slug: string }
  | { host: string; appHost?: string }
  | { default: true };

export function statusPageSlugMatches(actualSlug: string | null, expectedSlug?: string): boolean {
  return expectedSlug === undefined || actualSlug === expectedSlug;
}

export interface ResolvedStatusRoute {
  pageId: string;
  slug: string | null;
  requireAuth: boolean;
  statusPage: NonNullable<Awaited<ReturnType<typeof resolveStatusPage>>>;
}

/**
 * Resolve status page for any hostname (custom domain, generated/short subdomain, or localhost).
 * Uses the exact same normalization and subdomain matching across the application.
 */
export async function resolveStatusRouteForHostname(
  hostname: string,
  appHost?: string
): Promise<ResolvedStatusRoute | null> {
  const page = await resolveStatusPage({ host: hostname, appHost });
  if (!page) return null;
  return {
    pageId: page.id,
    slug: page.slug,
    requireAuth: !!page.requireAuth,
    statusPage: page,
  };
}

/** Resolve page identity once at the transport boundary; downstream code receives an explicit page id. */
export async function resolveStatusPage(identity: StatusPageIdentity = { default: true }) {
  if ('id' in identity) {
    return prisma.statusPage.findFirst({ where: { id: identity.id, enabled: true } });
  }
  if ('slug' in identity) {
    return prisma.statusPage.findFirst({ where: { slug: identity.slug, enabled: true } });
  }
  if ('host' in identity) {
    const host = normalizeHostname(identity.host);
    if (!host) return null;

    let appHost = identity.appHost ? parseHostname(identity.appHost) : '';
    if (!appHost) {
      try {
        const canonicalUrl = await getAppUrl();
        appHost = parseHostname(canonicalUrl);
      } catch {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '';
        appHost = parseHostname(appUrl);
      }
    }

    const candidates: Prisma.StatusPageWhereInput[] = [{ customDomain: host }, { subdomain: host }];

    const extractedSub = extractSubdomainFromHost(host, appHost);
    if (extractedSub) {
      candidates.push({ subdomain: extractedSub });
    }

    const pages = await prisma.statusPage.findMany({
      where: { enabled: true, OR: candidates },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });

    return pages.find(p => matchesStatusPageDomain(p, host, appHost)) ?? null;
  }
  return prisma.statusPage.findFirst({
    where: { isDefault: true, enabled: true },
  });
}

export async function resolveStatusPageId(identity: StatusPageIdentity = { default: true }) {
  const page = await resolveStatusPage(identity);
  return page?.id ?? null;
}
