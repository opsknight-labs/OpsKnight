'use server';

import prisma from '@/lib/prisma';
import { assertAdmin, getCurrentUser } from '@/lib/rbac';
import { decryptProviderConfig, maskSensitiveFields } from '@/lib/encrypted-provider-config';

/**
 * Get all notification provider configurations
 */
export async function getNotificationProviders() {
  await assertAdmin();

  const providers = await prisma.notificationProvider.findMany({
    orderBy: { provider: 'asc' },
  });

  return Promise.all(
    providers.map(async p => {
      let configurationState: 'VALID' | 'INCOMPLETE' | 'DECRYPTION_ERROR' | 'DISABLED' = p.enabled
        ? 'VALID'
        : 'DISABLED';
      if (p.enabled) {
        try {
          const decrypted = await decryptProviderConfig(
            p.provider,
            (p.config as Record<string, unknown>) || {}
          );
          if (Object.keys(decrypted).length === 0) {
            configurationState = 'INCOMPLETE';
          }
        } catch {
          configurationState = 'DECRYPTION_ERROR';
        }
      }
      return {
        id: p.id,
        provider: p.provider,
        enabled: p.enabled,
        config: maskSensitiveFields(p.provider, (p.config as Record<string, unknown>) || {}),
        updatedAt: p.updatedAt.toISOString(),
        configurationState,
      };
    })
  );
}

/**
 * Test a notification provider configuration by sending a test alert
 */
export async function testNotificationProvider(
  providerKey: string
): Promise<import('@/lib/provider-test-service').ProviderTestResult> {
  try {
    await assertAdmin();
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : 'Unauthorized. Admin access required.'
    );
  }

  const user = await getCurrentUser();
  const { executeProviderTest } = await import('@/lib/provider-test-service');
  return executeProviderTest(providerKey, user);
}

/**
 * Re-collect admin health diagnostic report
 */
export async function refreshAdminHealthAction(): Promise<{
  report: import('@/lib/admin-health').AdminHealthReport;
}> {
  await assertAdmin();
  const { collectAdminHealth } = await import('@/lib/admin-health');
  const report = await collectAdminHealth({ force: true });
  return { report };
}

/**
 * Re-evaluate a single admin health check by ID
 */
export async function refreshSingleHealthCheckAction(checkId: string): Promise<{
  check: import('@/lib/admin-health').AdminHealthCheck | null;
  report: import('@/lib/admin-health').AdminHealthReport;
}> {
  await assertAdmin();
  const { collectAdminHealth } = await import('@/lib/admin-health');
  const report = await collectAdminHealth({ force: true });
  const check = report.checks.find(c => c.id === checkId) || null;
  return { check, report };
}
