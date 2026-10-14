'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { assertAdmin, getCurrentUser } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { encrypt } from '@/lib/encryption';
import {
  parseSettingsRevision,
  settingsChangedState,
  type SettingsActionState,
} from '@/lib/settings-result';
import { hasIssuerMigrationConfirmation, isOidcIssuerMigration } from '@/lib/oidc/issuer-migration';
import { normalizeOidcProviderType } from '@/lib/oidc-provider';
import { validateOidcCustomScopes } from '@/lib/oidc/scopes';
import { getEnterpriseSessionPolicy } from '@/lib/local-auth-policy';

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

export async function saveOidcConfig(
  prevState: SettingsActionState | undefined,
  formData: FormData
): Promise<SettingsActionState> {
  const expectedUpdatedAt = prevState?.updatedAt ?? null;
  try {
    await assertAdmin();
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
    const _autoProvision =
      autoProvisionValue === 'on' ||
      autoProvisionValue === 'true' ||
      autoProvisionValue === 'checked';
    const allowedDomains = normalizeDomains(
      (formData.get('allowedDomains') as string | null) ?? ''
    );
    const rawCustomScopes = (formData.get('customScopes') as string | null)?.trim() ?? null;
    const _providerLabel = (formData.get('providerLabel') as string | null)?.trim() ?? null;
    const _organizationId = (formData.get('organizationId') as string | null)?.trim() ?? null;
    const rawTokenEndpointAuthMethod = (
      formData.get('tokenEndpointAuthMethod') as string | null
    )?.trim();
    const tokenEndpointAuthMethod =
      rawTokenEndpointAuthMethod === 'client_secret_post'
        ? 'client_secret_post'
        : 'client_secret_basic';
    const requestedProviderType = (formData.get('providerType') as string | null)?.trim();

    try {
      parseRoleMapping((formData.get('roleMapping') as string | null) || '[]');
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
    const defaultPolicy = getEnterpriseSessionPolicy();

    const rawMaxAge = (formData.get('sessionMaxAgeSeconds') as string | null)?.trim();
    const rawIdleTimeout = (formData.get('sessionIdleTimeoutSeconds') as string | null)?.trim();

    let sessionMaxAgeSeconds: number | null = null;
    if (rawMaxAge && rawMaxAge !== 'default') {
      const parsedMaxAge = Number.parseInt(rawMaxAge, 10);
      if (Number.isNaN(parsedMaxAge) || parsedMaxAge < 900 || parsedMaxAge > 2_592_000) {
        return {
          success: false,
          code: 'VALIDATION_ERROR',
          error: 'Maximum session lifetime must be between 15 minutes and 30 days.',
          updatedAt: expectedUpdatedAt,
        };
      }
      sessionMaxAgeSeconds = parsedMaxAge;
    }

    let _sessionIdleTimeoutSeconds: number | null = null;
    if (rawIdleTimeout && rawIdleTimeout !== 'default') {
      const parsedIdle = Number.parseInt(rawIdleTimeout, 10);
      if (Number.isNaN(parsedIdle) || parsedIdle < 300 || parsedIdle > 604_800) {
        return {
          success: false,
          code: 'VALIDATION_ERROR',
          error: 'Idle inactivity timeout must be between 5 minutes and 7 days.',
          updatedAt: expectedUpdatedAt,
        };
      }
      const effectiveMaxAge =
        sessionMaxAgeSeconds ?? existing?.sessionMaxAgeSeconds ?? defaultPolicy.maximumAgeSeconds;
      if (parsedIdle > effectiveMaxAge) {
        return {
          success: false,
          code: 'VALIDATION_ERROR',
          error: 'Idle inactivity timeout cannot exceed maximum session lifetime.',
          updatedAt: expectedUpdatedAt,
        };
      }
      _sessionIdleTimeoutSeconds = parsedIdle;
    }

    const issuer = (rawIssuer || existing?.issuer || '').trim();
    const clientId = (rawClientId || existing?.clientId || '').trim();
    const providerType = normalizeOidcProviderType(requestedProviderType, issuer);
    const scopeValidation = validateOidcCustomScopes(rawCustomScopes, providerType);
    if (!scopeValidation.ok) {
      return {
        success: false,
        code: 'VALIDATION_ERROR',
        error: scopeValidation.error,
        updatedAt: expectedUpdatedAt,
      };
    }
    const _customScopes = scopeValidation.scopes;

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

    return {
      success: false,
      code: 'VALIDATION_ERROR',
      error:
        'Provider changes require staged configuration and a verified administrator login in System → SSO / Authentication.',
      updatedAt: expectedUpdatedAt,
    };
  } catch {
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      error: 'Invalid legacy SSO configuration. Use the staged authentication console.',
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

export async function getScimConfigAction() {
  await assertAdmin();
  const { getScimConfig } = await import('@/lib/scim');
  return getScimConfig();
}

export async function generateScimTokenAction() {
  try {
    const actor = await assertAdmin();
    const { generateAndSaveScimToken } = await import('@/lib/scim');
    const result = await generateAndSaveScimToken(actor.id);
    revalidatePath('/settings/security');
    return { success: true, ...result };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate SCIM token',
    };
  }
}

export async function revokeScimTokenAction() {
  try {
    const actor = await assertAdmin();
    const { revokeScimToken } = await import('@/lib/scim');
    await revokeScimToken(actor.id);
    revalidatePath('/settings/security');
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to revoke SCIM token',
    };
  }
}

export async function revealScimTokenAction() {
  try {
    await assertAdmin();
    const { revealScimToken } = await import('@/lib/scim');
    const token = await revealScimToken();
    return { success: true, token };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to reveal SCIM token',
    };
  }
}
