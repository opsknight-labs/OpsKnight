import 'server-only';
import prisma from '@/lib/prisma';

export type ManagedProfileField = 'name' | 'department' | 'jobTitle';

/**
 * One answer, used everywhere, to "is this account connected to single sign-on, and which of
 * its profile fields does the company directory or SSO overwrite?" so pages never disagree.
 */
export async function userIdentityStatus(userId: string) {
  const [user, config] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        lastOidcSync: true,
        _count: { select: { oidcIdentities: true } },
        scimIdentities: {
          where: { deletedAt: null, connector: { enabled: true } },
          select: { connector: { select: { name: true, profileFields: true } } },
          take: 1,
        },
      },
    }),
    prisma.oidcConfig.findUnique({
      where: { id: 'default' },
      select: { enabled: true, profileMapping: true },
    }),
  ]);
  const managed = new Map<ManagedProfileField, string>();
  const scim = user?.scimIdentities[0]?.connector;
  if (scim) {
    const source = `your company directory (${scim.name})`;
    if (scim.profileFields.includes('name')) managed.set('name', source);
    if (scim.profileFields.includes('department')) managed.set('department', source);
    if (scim.profileFields.includes('title')) managed.set('jobTitle', source);
  }
  const ssoLinked = Boolean(user?.lastOidcSync || (user?._count.oidcIdentities ?? 0) > 0);
  const mapping =
    config?.enabled && config.profileMapping && typeof config.profileMapping === 'object'
      ? (config.profileMapping as Record<string, unknown>)
      : {};
  if (ssoLinked) {
    // SCIM wins over SSO for fields it owns, so only fill in what SCIM does not manage.
    if (mapping.department && !managed.has('department'))
      managed.set('department', 'single sign-on');
    if (mapping.jobTitle && !managed.has('jobTitle')) managed.set('jobTitle', 'single sign-on');
  }
  return {
    ssoLinked,
    managedFields: Object.fromEntries(managed) as Partial<Record<ManagedProfileField, string>>,
  };
}
