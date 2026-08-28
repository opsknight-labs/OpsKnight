import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { assertAdmin } from '@/lib/rbac';
import { getDecryptedJiraConfig, testJiraConnection } from '@/lib/jira';

export async function POST() {
  try {
    await assertAdmin();
    const config = await getDecryptedJiraConfig();
    if (!config) {
      return jsonError(
        new AppError({
          code: 'INTEGRATION_DISABLED',
          userMessage: 'Jira is not configured or is disabled.',
          action: 'Configure and enable Jira before testing the connection.',
          details: { provider: 'jira' },
        })
      );
    }

    const result = await testJiraConnection(config);
    return jsonOk({
      ok: true,
      accountId: result.accountId,
      displayName: result.displayName,
      emailAddress: result.emailAddress,
    });
  } catch (error) {
    logger.error('api.jira.test_failed', {
      error,
      errorCode: isAppError(error) ? error.code : 'INTERNAL_ERROR',
    });
    if (isAppError(error)) return jsonError(error);
    return jsonError('Failed to test Jira connection.', 500);
  }
}
