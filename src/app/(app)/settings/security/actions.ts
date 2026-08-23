'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { assertAdmin, getCurrentUser } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { encrypt } from '@/lib/encryption';

function normalizeDomains(value: string) {
  if (!value) return [];
  return value
    .split(/[\n,\s]+/)
    .map(domain => domain.trim().toLowerCase())
    .filter(Boolean);
}

function isValidIssuer(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidDomain(domain: string) {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain);
}

type RoleMappingRule = {
  claim: string;
  value: string;
  role: 'ADMIN' | 'RESPONDER' | 'USER';
};

const allowedRoles = new Set<RoleMappingRule['role']>(['ADMIN', 'RESPONDER', 'USER']);

function parseRoleMapping(input: string): RoleMappingRule[] | null {
  const parsed: unknown = JSON.parse(input);
  if (!Array.isArray(parsed)) {
    throw new Error('Role mapping must be an array.');
  }

  const rules: RoleMappingRule[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('Role mapping entries must be objects.');
    }

    const candidate = entry as Record<string, unknown>;
    const claim = typeof candidate.claim === 'string' ? candidate.claim.trim() : '';
    const value = typeof candidate.value === 'string' ? candidate.value.trim() : '';
    const role = typeof candidate.role === 'string' ? candidate.role : '';

    if (!claim || !value || !allowedRoles.has(role as RoleMappingRule['role'])) {
      throw new Error('Role mapping entries must include claim, value, and a valid role.');
    }

    rules.push({ claim, value, role: role as RoleMappingRule['role'] });
  }

  return rules;
}

export async function saveOidcConfig(
  prevState: { error?: string | null; success?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string | null; success?: boolean }> {
  try {
    await assertAdmin();
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unauthorized. Admin access required.',
    };
  }

  const issuer = (formData.get('issuer') as string | null)?.trim() ?? '';
  const clientId = (formData.get('clientId') as string | null)?.trim() ?? '';
  const clientSecret = (formData.get('clientSecret') as string | null)?.trim() ?? '';
  const enabledValue = formData.get('enabled');
  const autoProvisionValue = formData.get('autoProvision');
  const enabled = enabledValue === 'on' || enabledValue === 'true';
  const autoProvision = autoProvisionValue === 'on' || autoProvisionValue === 'true';
  const allowedDomainsInput = (formData.get('allowedDomains') as string | null) ?? '';
  const allowedDomains = normalizeDomains(allowedDomainsInput);
  const customScopes = (formData.get('customScopes') as string | null)?.trim() ?? null;
  const providerLabel = (formData.get('providerLabel') as string | null)?.trim() ?? null;

  // Auto-detect provider type from Issuer URL
  function detectProviderType(issuerUrl: string): string {
    const url = issuerUrl.toLowerCase();
    if (
      url.includes('accounts.google.com') ||
      url.includes('googleapis.com') ||
      url.includes('google')
    ) {
      return 'google';
    }
    if (url.includes('okta')) return 'okta';
    if (
      url.includes('login.microsoftonline.com') ||
      url.includes('login.microsoft.com') ||
      url.includes('sts.windows.net') ||
      url.includes('microsoftonline')
    ) {
      return 'azure';
    }
    if (url.includes('auth0')) return 'auth0';
    return 'custom';
  }
  const providerType = detectProviderType(issuer);

  // Profile Mapping - collect individual fields
  const profileMapping: Record<string, string> = {};
  const pmDepartment = (formData.get('profileMapping.department') as string | null)?.trim();
  const pmJobTitle = (formData.get('profileMapping.jobTitle') as string | null)?.trim();
  const pmAvatarUrl = (formData.get('profileMapping.avatarUrl') as string | null)?.trim();
  if (pmDepartment) profileMapping.department = pmDepartment;
  if (pmJobTitle) profileMapping.jobTitle = pmJobTitle;
  if (pmAvatarUrl) profileMapping.avatarUrl = pmAvatarUrl;

  let roleMapping: RoleMappingRule[] | null = null;
  const roleMappingInput = formData.get('roleMapping') as string | null;
  if (roleMappingInput) {
    try {
      roleMapping = parseRoleMapping(roleMappingInput);
    } catch {
      return { error: 'Invalid Role Mapping configuration.' };
    }
  }

  if (!issuer || !isValidIssuer(issuer)) {
    return { error: 'Issuer URL must be a valid HTTPS URL.' };
  }

  if (!clientId) {
    return { error: 'Client ID is required.' };
  }

  if (allowedDomains.length > 0 && allowedDomains.some(domain => !isValidDomain(domain))) {
    return { error: 'Allowed domains must be valid domain names.' };
  }

  if (enabled) {
    // Perform "Dry Run" validation
    const { validateOidcConnection } = await import('@/lib/oidc-validation');
    const validation = await validateOidcConnection(issuer);
    if (!validation.isValid) {
      return { error: validation.error || 'Failed to validate OIDC connection.' };
    }
  }

  const existing = await prisma.oidcConfig.findFirst({
    orderBy: { updatedAt: 'desc' },
  });

  if (!existing && !clientSecret) {
    return { error: 'Client Secret is required for new configuration.' };
  }

  let encryptedSecret = existing?.clientSecret ?? null;
  if (clientSecret && clientSecret !== '********') {
    encryptedSecret = await encrypt(clientSecret);
  } else if (enabled && !encryptedSecret) {
    return { error: 'Client Secret is required for new configuration.' };
  }

  const user = await getCurrentUser();
  const actorId = user.id;

  await prisma.oidcConfig.upsert({
    where: { id: existing?.id || 'default' },
    create: {
      id: 'default',
      issuer,
      clientId,
      clientSecret: encryptedSecret || '',
      enabled,
      autoProvision,
      allowedDomains,
      roleMapping: roleMapping ?? [],
      customScopes,
      providerType,
      providerLabel,
      profileMapping: Object.keys(profileMapping).length > 0 ? profileMapping : {},
      updatedBy: actorId,
    },
    update: {
      issuer,
      clientId,
      ...(encryptedSecret ? { clientSecret: encryptedSecret } : {}),
      enabled,
      autoProvision,
      allowedDomains,
      roleMapping: roleMapping ?? [],
      customScopes,
      providerType,
      providerLabel,
      profileMapping: Object.keys(profileMapping).length > 0 ? profileMapping : {},
      updatedBy: actorId,
    },
  });

  await logAudit({
    action: 'oidc.config.updated',
    entityType: 'USER',
    entityId: user.id,
    actorId,
    details: {
      enabled,
      autoProvision,
      issuer,
      allowedDomainsCount: allowedDomains.length,
      hasRoleMapping: !!roleMapping,
      customScopes,
    },
  });

  const { resetAuthOptionsCache } = await import('@/lib/auth');
  resetAuthOptionsCache();

  revalidatePath('/settings/security');
  revalidatePath('/login');

  return { success: true };
}

export async function revokeAllSessions(): Promise<{ success?: boolean; error?: string }> {
  try {
    const user = await getCurrentUser();

    // Import revokeUserSessions from auth
    const { revokeUserSessions } = await import('@/lib/auth');

    // Revoke all sessions by incrementing tokenVersion
    await revokeUserSessions(user.id);

    // Log the action
    await logAudit({
      action: 'session.revoked_all',
      entityType: 'USER',
      entityId: user.id,
      actorId: user.id,
      details: {
        reason: 'User initiated session revocation',
      },
    });

    revalidatePath('/settings/security');

    return { success: true };
  } catch (error) {
    console.error('[Security] Failed to revoke sessions:', error);
    return {
      error: error instanceof Error ? error.message : 'Failed to revoke sessions',
    };
  }
}
