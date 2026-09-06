import prisma from '@/lib/prisma';

export type StatusPageIdentity =
  | { id: string }
  | { slug: string }
  | { host: string }
  | { default: true };

function normalizedHost(value: string): string {
  return value.trim().toLowerCase().split(':')[0] ?? '';
}

export function statusPageSlugMatches(actualSlug: string | null, expectedSlug?: string): boolean {
  return expectedSlug === undefined || actualSlug === expectedSlug;
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
    const host = normalizedHost(identity.host);
    if (!host) return null;
    return prisma.statusPage.findFirst({
      where: { enabled: true, OR: [{ customDomain: host }, { subdomain: host }] },
    });
  }
  return prisma.statusPage.findFirst({
    where: { isDefault: true, enabled: true },
  });
}

export async function resolveStatusPageId(identity: StatusPageIdentity = { default: true }) {
  const page = await resolveStatusPage(identity);
  return page?.id ?? null;
}
