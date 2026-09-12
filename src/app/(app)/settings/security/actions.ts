'use server';

import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { assertAdmin, getCurrentUser } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { encrypt } from '@/lib/encryption';
import {
  SettingsChangedMutationError,
  isSettingsChangedError,
  parseSettingsRevision,
  settingsChangedState,
  type SettingsActionState,
} from '@/lib/settings-result';
import {
  hasIssuerMigrationConfirmation,
  isOidcIssuerMigration,
  normalizeOidcIssuer,
} from '@/lib/oidc/issuer-migration';
import { normalizeOidcProviderType } from '@/lib/oidc-provider';

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
  role: 'ADMIN' | 'RESPONDER' | 'AUDITOR' | 'USER';
};

const allowedRoles = new Set<RoleMappingRule['role']>(['ADMIN', 'RESPONDER', 'AUDITOR', 'USER']);

function parseRoleMapping(input: string): RoleMappingRule[] {
  const parsed: unknown = JSON.parse(input || '[]');
  if (!Array.isArray(parsed)) throw new Error('Role mapping must be an array.');

  return parsed.map(entry => {
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
    return { claim, value, role: role as RoleMappingRule['role'] };
  });
}

function stableSerializeRoleMapping(mapping: unknown): string {
  if (!Array.isArray(mapping)) return '[]';
  // Preserve rule order: role evaluation in mapClaimsToRole uses first-match-wins semantics,
  // so rule order changes are semantically significant security changes.
  const normalized = mapping.map(entry => {
    if (!entry || typeof entry !== 'object') return entry;
    const candidate = entry as Record<string, unknown>;
    return {
      claim: String(candidate.claim ?? '').trim(),
      value: String(candidate.value ?? '').trim(),
      role: String(candidate.role ?? '').trim(),
    };
  });
  return JSON.stringify(normalized);
}

export async function saveOidcConfig(
  prevState: SettingsActionState | undefined,
  formData: FormData
): Promise<SettingsActionState> {
  const expectedUpdatedAt = prevState?.updatedAt ?? null;
  let actor;
  try {
    actor = await assertAdmin();
  } catch (error) {
    return {
      success: false,
      code: 'FORBIDDEN',
      error: error instanceof Error ? error.message : 'Unauthorized. Admin access required.',
      updatedAt: expectedUpdatedAt,
    };
  }

  try {
    const rawIssuer = (formData.get('issuer') as string | null)?.trim() ?? '';
    const rawClientId = (formData.get('clientId') as string | null)?.trim() ?? '';
    const clientSecret = (formData.get('clientSecret') as string | null)?.trim() ?? '';
    const enabledValue = formData.get('enabled');
    const autoProvisionValue = formData.get('autoProvision');
    const enabled = enabledValue === 'on' || enabledValue === 'true' || enabledValue === 'checked';
    const autoProvision =
      autoProvisionValue === 'on' ||
      autoProvisionValue === 'true' ||
      autoProvisionValue === 'checked';
    const allowedDomains = normalizeDomains(
      (formData.get('allowedDomains') as string | null) ?? ''
    );
    const customScopes = (formData.get('customScopes') as string | null)?.trim() ?? null;
    const providerLabel = (formData.get('providerLabel') as string | null)?.trim() ?? null;
    const organizationId = (formData.get('organizationId') as string | null)?.trim() ?? null;
    const rawTokenEndpointAuthMethod = (
      formData.get('tokenEndpointAuthMethod') as string | null
    )?.trim();
    const tokenEndpointAuthMethod =
      rawTokenEndpointAuthMethod === 'client_secret_post'
        ? 'client_secret_post'
        : 'client_secret_basic';
    const requestedProviderType = (formData.get('providerType') as string | null)?.trim();

    let roleMapping: RoleMappingRule[];
    try {
      roleMapping = parseRoleMapping((formData.get('roleMapping') as string | null) || '[]');
    } catch {
      return {
        success: false,
        code: 'VALIDATION_ERROR',
        error: 'Invalid Role Mapping configuration.',
        updatedAt: expectedUpdatedAt,
      };
    }

    const profileMapping: Record<string, string> = {};
    const pmDepartment = (formData.get('profileMapping.department') as string | null)?.trim();
    const pmJobTitle = (formData.get('profileMapping.jobTitle') as string | null)?.trim();
    const pmAvatarUrl = (formData.get('profileMapping.avatarUrl') as string | null)?.trim();
    if (pmDepartment) profileMapping.department = pmDepartment;
    if (pmJobTitle) profileMapping.jobTitle = pmJobTitle;
    if (pmAvatarUrl) profileMapping.avatarUrl = pmAvatarUrl;

    const existing = await prisma.oidcConfig.findFirst({ orderBy: { updatedAt: 'desc' } });
    const issuer = (rawIssuer || existing?.issuer || '').trim();
    const clientId = (rawClientId || existing?.clientId || '').trim();

    if (enabled) {
      if (!issuer || !isValidIssuer(issuer)) {
        return {
          success: false,
          code: 'VALIDATION_ERROR',
          error: 'Issuer URL must be a valid HTTPS URL.',
          updatedAt: expectedUpdatedAt,
        };
      }
      if (!clientId) {
        return {
          success: false,
          code: 'VALIDATION_ERROR',
          error: 'Client ID is required.',
          updatedAt: expectedUpdatedAt,
        };
      }
      if (allowedDomains.length > 0 && allowedDomains.some(domain => !isValidDomain(domain))) {
        return {
          success: false,
          code: 'VALIDATION_ERROR',
          error: 'Allowed domains must be valid domain names.',
          updatedAt: expectedUpdatedAt,
        };
      }

      const { validateOidcConnection } = await import('@/lib/oidc-validation');
      const validation = await validateOidcConnection(issuer, { tokenEndpointAuthMethod });
      if (!validation.isValid) {
        return {
          success: false,
          code: 'PROVIDER_ERROR',
          error: validation.error || 'Failed to validate OIDC connection.',
          updatedAt: expectedUpdatedAt,
        };
      }
    } else if (!existing) {
      if (!issuer || !isValidIssuer(issuer)) {
        return {
          success: false,
          code: 'VALIDATION_ERROR',
          error: 'Issuer URL must be a valid HTTPS URL.',
          updatedAt: expectedUpdatedAt,
        };
      }
      if (!clientId) {
        return {
          success: false,
          code: 'VALIDATION_ERROR',
          error: 'Client ID is required.',
          updatedAt: expectedUpdatedAt,
        };
      }
    }

    const issuerMigration = existing ? isOidcIssuerMigration(existing.issuer, issuer) : false;
    if (issuerMigration && !hasIssuerMigrationConfirmation(formData)) {
      return {
        success: false,
        code: 'VALIDATION_ERROR',
        error:
          'Issuer changes cross an identity trust boundary. Confirm the migration to revoke existing OIDC sessions and pending link approvals.',
        updatedAt: expectedUpdatedAt,
      };
    }
    const expectedRevision = parseSettingsRevision(expectedUpdatedAt);
    if (existing && !expectedRevision) return settingsChangedState(expectedUpdatedAt);
    if (!existing && expectedRevision) return settingsChangedState(expectedUpdatedAt);

    if (!existing && !clientSecret && enabled) {
      return {
        success: false,
        code: 'VALIDATION_ERROR',
        error: 'Client Secret is required for new configuration.',
        updatedAt: expectedUpdatedAt,
      };
    }

    const clientSecretChanged = Boolean(clientSecret) && clientSecret !== '********';
    let encryptedSecret = existing?.clientSecret ?? null;
    if (clientSecretChanged) {
      encryptedSecret = await encrypt(clientSecret);
    } else if (enabled && !encryptedSecret) {
      return {
        success: false,
        code: 'VALIDATION_ERROR',
        error: 'Client Secret is required for configuration.',
        updatedAt: expectedUpdatedAt,
      };
    }

    const providerType = normalizeOidcProviderType(requestedProviderType, issuer);
    const updatedAt = await prisma.$transaction(async tx => {
      const id = existing?.id ?? 'default';
      if (existing) {
        const roleMappingChanged =
          stableSerializeRoleMapping(existing.roleMapping) !==
          stableSerializeRoleMapping(roleMapping);
        const customScopesChanged = (existing.customScopes ?? null) !== (customScopes ?? null);

        const securityConfigChanged =
          normalizeOidcIssuer(existing.issuer) !== normalizeOidcIssuer(issuer) ||
          existing.clientId !== clientId ||
          clientSecretChanged ||
          existing.enabled !== enabled ||
          existing.providerType !== providerType ||
          existing.organizationId !== organizationId ||
          existing.tokenEndpointAuthMethod !== tokenEndpointAuthMethod ||
          roleMappingChanged ||
          customScopesChanged ||
          JSON.stringify(existing.allowedDomains ?? []) !== JSON.stringify(allowedDomains ?? []);

        const updated = await tx.oidcConfig.updateMany({
          where: { id: existing.id, updatedAt: expectedRevision! },
          data: {
            issuer,
            clientId,
            ...(clientSecretChanged && encryptedSecret ? { clientSecret: encryptedSecret } : {}),
            enabled,
            autoProvision,
            allowedDomains,
            roleMapping: roleMapping as Prisma.InputJsonValue,
            customScopes,
            providerType,
            providerLabel,
            organizationId,
            tokenEndpointAuthMethod,
            profileMapping:
              Object.keys(profileMapping).length > 0
                ? (profileMapping as Prisma.InputJsonObject)
                : Prisma.JsonNull,
            updatedBy: actor.id,
            ...(securityConfigChanged ? { configVersion: { increment: 1 } } : {}),
          },
        });
        if (updated.count !== 1) throw new SettingsChangedMutationError();

        if (issuerMigration) {
          const previousIssuer = normalizeOidcIssuer(existing.issuer);
          await tx.user.updateMany({
            where: { oidcIdentities: { some: { issuer: previousIssuer } } },
            data: { tokenVersion: { increment: 1 } },
          });
        }
        if (securityConfigChanged) {
          await tx.oidcLinkingApproval.updateMany({
            where: {
              providerConfigId: existing.id,
              consumedAt: null,
              revokedAt: null,
            },
            data: { revokedAt: new Date() },
          });
        }
      } else {
        await tx.oidcConfig.create({
          data: {
            id,
            issuer,
            clientId,
            clientSecret: encryptedSecret || '',
            enabled,
            autoProvision,
            allowedDomains,
            roleMapping: roleMapping as Prisma.InputJsonValue,
            customScopes,
            providerType,
            providerLabel,
            organizationId,
            tokenEndpointAuthMethod,
            profileMapping:
              Object.keys(profileMapping).length > 0
                ? (profileMapping as Prisma.InputJsonObject)
                : Prisma.JsonNull,
            updatedBy: actor.id,
          },
        });
      }

      await logAudit(
        {
          action: 'oidc.config.updated',
          entityType: 'SSO_CONFIG',
          entityId: id,
          actorId: actor.id,
          oldValue: existing
            ? {
                enabled: existing.enabled,
                issuer: existing.issuer,
                clientId: existing.clientId,
                autoProvision: existing.autoProvision,
                allowedDomains: existing.allowedDomains,
                customScopes: existing.customScopes,
                providerType: existing.providerType,
                providerLabel: existing.providerLabel,
                organizationId: existing.organizationId,
                tokenEndpointAuthMethod: existing.tokenEndpointAuthMethod,
                hasClientSecret: Boolean(existing.clientSecret),
              }
            : null,
          newValue: {
            enabled,
            issuer,
            clientId,
            autoProvision,
            allowedDomains,
            customScopes,
            providerType,
            providerLabel,
            organizationId,
            tokenEndpointAuthMethod,
            roleMappingCount: roleMapping.length,
            hasClientSecret: Boolean(encryptedSecret),
          },
          details: {
            integration: 'oidc',
            issuerMigration,
            ...(issuerMigration
              ? {
                  previousIssuer: normalizeOidcIssuer(existing!.issuer),
                  sessionsRevoked: true,
                  pendingLinkApprovalsRevoked: true,
                }
              : {}),
          },
        },
        tx
      );

      const saved = await tx.oidcConfig.findUniqueOrThrow({
        where: { id },
        select: { updatedAt: true },
      });
      return saved.updatedAt.toISOString();
    });

    const { resetAuthOptionsCache } = await import('@/lib/auth');
    resetAuthOptionsCache();
    // Invalidate the OIDC config caches too — the freshly saved issuer,
    // client secret and enabled state must take effect immediately rather
    // than remaining stale for several seconds.
    const { resetOidcConfigCache } = await import('@/lib/oidc-config');
    resetOidcConfigCache();
    const { resetOidcRuntimeMetadataCache } = await import('@/lib/oidc-validation');
    resetOidcRuntimeMetadataCache();
    revalidatePath('/settings/security');
    revalidatePath('/settings/system');
    revalidatePath('/login');

    return { success: true, error: null, updatedAt };
  } catch (error) {
    if (
      isSettingsChangedError(error) ||
      (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
    ) {
      return settingsChangedState(expectedUpdatedAt);
    }
    return {
      success: false,
      code: 'INTERNAL_ERROR',
      error: 'Failed to save SSO configuration.',
      updatedAt: expectedUpdatedAt,
    };
  }
}

export async function validateOidcConnectionAction(
  issuer: string,
  options?: { tokenEndpointAuthMethod?: string }
) {
  await assertAdmin();
  if (!issuer) return { isValid: false, error: 'Issuer URL is missing' };
  const { validateOidcConnection } = await import('@/lib/oidc-validation');
  return validateOidcConnection(issuer, options);
}

export async function revokeAllSessions(): Promise<{ success?: boolean; error?: string }> {
  try {
    const user = await getCurrentUser();
    const { revokeUserSessions } = await import('@/lib/auth');
    await revokeUserSessions(user.id);

    await logAudit({
      action: 'session.revoked_all',
      entityType: 'USER',
      entityId: user.id,
      actorId: user.id,
      details: { reason: 'User initiated session revocation' },
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
