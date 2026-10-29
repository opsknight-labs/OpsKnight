import { NextRequest } from 'next/server';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { decrypt } from '@/lib/encryption';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { assertAdmin } from '@/lib/rbac';
import { testJiraConnection } from '@/lib/jira';
import { normalizeJiraBaseUrl } from '@/lib/jira-validation';

const JiraTestSchema = z.object({
  baseUrl: z.string().trim().min(1).optional(),
  userEmail: z.string().trim().email().optional(),
  apiToken: z.string().trim().optional(),
});

export async function POST(request: NextRequest) {
  try {
    await assertAdmin();

    const existing = await prisma.jiraConfig.findUnique({
      where: { id: 'default' },
      select: { baseUrl: true, userEmail: true, apiTokenEncrypted: true },
    });

    let body: unknown = {};
    const raw = await request.text();
    if (raw.trim()) {
      try {
        body = JSON.parse(raw);
      } catch (error) {
        return jsonError(new AppError({ code: 'INVALID_JSON', cause: error }));
      }
    }

    const parsed = JiraTestSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: 'Invalid Jira test configuration.',
          fields: parsed.error.issues.map(issue => ({
            field: issue.path.join('.') || 'request',
            code: issue.code,
            message: issue.message,
          })),
        })
      );
    }

    const candidate = parsed.data;
    const baseUrl = normalizeJiraBaseUrl(candidate.baseUrl || existing?.baseUrl || '');
    const userEmail = (candidate.userEmail || existing?.userEmail || '').trim().toLowerCase();
    const candidateToken = candidate.apiToken?.trim();
    const isStoredOrigin = (() => {
      if (!existing?.baseUrl || !baseUrl) return false;
      try {
        return new URL(baseUrl).origin === new URL(normalizeJiraBaseUrl(existing.baseUrl)).origin;
      } catch {
        return false;
      }
    })();
    const apiToken =
      candidateToken && candidateToken !== '********'
        ? candidateToken
        : isStoredOrigin && existing?.apiTokenEncrypted
          ? await decrypt(existing.apiTokenEncrypted)
          : '';

    if (!baseUrl || !userEmail || !apiToken) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: 'Jira URL, user email, and API token are required for a connection test.',
          action: 'Complete the visible Jira credentials and try again.',
        })
      );
    }

    const result = await testJiraConnection({ baseUrl, userEmail, apiToken });
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
