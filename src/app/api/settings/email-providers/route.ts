import { NextRequest } from 'next/server';
import { assertAdmin } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { isAppError } from '@/lib/errors';
import prisma from '@/lib/prisma';
import { decryptProviderConfig } from '@/lib/encrypted-provider-config';

function isProviderConfig(config: unknown): config is Record<string, unknown> {
  return typeof config === 'object' && config !== null;
}

/**
 * GET /api/settings/email-providers
 * Get available email providers (for status page subscription config)
 */
export async function GET(_req: NextRequest) {
  try {
    await assertAdmin();

    const [resendProvider, sendgridProvider, smtpProvider, sesProvider] = await Promise.all([
      prisma.notificationProvider.findUnique({ where: { provider: 'resend' } }),
      prisma.notificationProvider.findUnique({ where: { provider: 'sendgrid' } }),
      prisma.notificationProvider.findUnique({ where: { provider: 'smtp' } }),
      prisma.notificationProvider.findUnique({ where: { provider: 'ses' } }),
    ]);

    const providers: Array<{ provider: string; enabled: true }> = [];

    if (resendProvider?.enabled && isProviderConfig(resendProvider.config)) {
      const config = await decryptProviderConfig('resend', resendProvider.config);
      if (config?.apiKey) providers.push({ provider: 'resend', enabled: true });
    }

    if (sendgridProvider?.enabled && isProviderConfig(sendgridProvider.config)) {
      const config = await decryptProviderConfig('sendgrid', sendgridProvider.config);
      if (config?.apiKey) providers.push({ provider: 'sendgrid', enabled: true });
    }

    if (smtpProvider?.enabled && isProviderConfig(smtpProvider.config)) {
      const config = await decryptProviderConfig('smtp', smtpProvider.config);
      if (config?.host && config?.user && config?.password) {
        providers.push({ provider: 'smtp', enabled: true });
      }
    }

    if (sesProvider?.enabled && isProviderConfig(sesProvider.config)) {
      const config = await decryptProviderConfig('ses', sesProvider.config);
      if (config?.accessKeyId && config?.secretAccessKey) {
        providers.push({ provider: 'ses', enabled: true });
      }
    }

    return jsonOk({ providers });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError('Failed to fetch email providers', 500);
  }
}
