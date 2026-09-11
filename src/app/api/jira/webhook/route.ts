import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { decrypt } from '@/lib/encryption';
import { isAppError } from '@/lib/errors';
import { processJiraWebhookEvent, type JiraWebhookPayload } from '@/lib/jira-sync';
import { withJiraWorkspaceProviderFence } from '@/lib/jira-concurrency';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger, withRequestContext } from '@/lib/logger';
import { getClientIp } from '@/lib/client-ip';
import { readIntegrationBody } from '@/lib/integrations/request-security';

const JiraWebhookSchema = z
  .object({
    webhookEvent: z.string().optional(),
    issue_event_type_name: z.string().optional(),
    issue: z
      .object({
        id: z.string().optional(),
        key: z.string().optional(),
        fields: z.record(z.unknown()).optional(),
      })
      .optional(),
    changelog: z
      .object({
        id: z.string().optional(),
        items: z
          .array(
            z.object({
              field: z.string().optional(),
              fieldId: z.string().optional(),
              fromString: z.string().nullable().optional(),
              toString: z.string().nullable().optional(),
              from: z.string().nullable().optional(),
              to: z.string().nullable().optional(),
            })
          )
          .optional(),
      })
      .optional(),
    comment: z
      .object({
        id: z.string().optional(),
        body: z.unknown().optional(),
      })
      .optional(),
    timestamp: z.union([z.number(), z.string()]).optional(),
    user: z.record(z.unknown()).optional(),
  })
  .passthrough();

/**
 * Extracts webhook secret from incoming request.
 * Supports:
 * 1. x-jira-webhook-secret HTTP header
 * 2. Authorization: Bearer <token> HTTP header
 * 3. ?secret=<token> query parameter (required for Jira Cloud, where the WebHooks UI does not support custom headers)
 * 4. ?token=<token> query parameter
 */
export function extractWebhookProvidedSecret(request: NextRequest): string | null {
  return (
    request.headers.get('x-jira-webhook-secret') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    request.nextUrl.searchParams.get('secret') ??
    request.nextUrl.searchParams.get('token') ??
    null
  );
}

async function verifyEncryptedWebhookSecret(
  request: NextRequest,
  webhookSecretEncrypted: string | null | undefined
): Promise<boolean> {
  if (!webhookSecretEncrypted) {
    // No secret configured — only accept in development mode.
    // In production, unsigned webhooks are a security risk.
    if (process.env.NODE_ENV === 'development') {
      logger.warn('Jira webhook secret not configured — accepting in dev mode', {
        component: 'jira-webhook',
      });
      return true;
    }
    logger.error(
      'Jira webhook rejected: no webhook secret configured. ' +
        'Configure a webhook secret in Settings → Integrations → Jira.',
      { component: 'jira-webhook' }
    );
    return false;
  }

  const secret = await decrypt(webhookSecretEncrypted);
  const provided = extractWebhookProvidedSecret(request);
  if (!provided) return false;

  try {
    const { safeCompare } = await import('@/lib/integrations/signature-verification');
    return safeCompare(secret, provided);
  } catch {
    return false;
  }
}

export async function verifyWebhookSecret(request: NextRequest): Promise<boolean> {
  const config = await prisma.jiraConfig.findUnique({
    where: { id: 'default' },
    select: { webhookSecretEncrypted: true },
  });
  return verifyEncryptedWebhookSecret(request, config?.webhookSecretEncrypted);
}

const HANDLED_EVENTS = new Set([
  'jira:issue_updated',
  'jira:issue_generic',
  'jira:issue_created',
  'jira:issue_deleted',
  'issue_updated',
  'issue_generic',
  'issue_created',
  'issue_deleted',
]);

function isHandledJiraEvent(event?: string, eventType?: string): boolean {
  const candidate = (event || eventType || '').toLowerCase().trim();
  if (!candidate) return false;
  if (HANDLED_EVENTS.has(candidate)) return true;
  if (candidate.startsWith('jira:issue_') || candidate.startsWith('issue_')) return true;
  return false;
}

function isWorkspaceUnavailable(error: unknown): boolean {
  return (
    isAppError(error) &&
    error.code === 'INTEGRATION_DISABLED' &&
    error.details?.provider === 'jira'
  );
}

async function postJiraWebhook(request: NextRequest) {
  try {
    const clientIp = getClientIp(request.headers);
    const rl = await checkRateLimit(`jira-webhook:${clientIp}`, 60, 60_000); // 60 req/min
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        {
          status: 429,
          headers: {
            'X-RateLimit-Remaining': '0',
            'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
          },
        }
      );
    }

    // Check lifecycle state before authenticating or parsing the body. After an
    // admin disables/removes Jira, Atlassian may continue delivering the old
    // webhook until it is removed there. Acknowledge those requests as no-ops
    // so they cannot mutate OpsKnight and do not create retry storms.
    const jiraConfig = await prisma.jiraConfig.findUnique({
      where: { id: 'default' },
      select: { enabled: true, webhookSecretEncrypted: true },
    });
    if (!jiraConfig?.enabled) {
      const reason = jiraConfig ? 'integration_disabled' : 'integration_not_configured';
      logger.info('Jira webhook acknowledged without processing', {
        component: 'jira-webhook',
        reason,
      });
      return NextResponse.json({ ok: true, updated: 0, reason });
    }

    const isValid = await verifyEncryptedWebhookSecret(request, jiraConfig.webhookSecretEncrypted);
    if (!isValid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: unknown;
    try {
      body = JSON.parse(await readIntegrationBody(request));
    } catch {
      return NextResponse.json({ error: 'Malformed JSON payload' }, { status: 400 });
    }
    const parsed = JiraWebhookSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const payload = parsed.data;

    if (!isHandledJiraEvent(payload.webhookEvent, payload.issue_event_type_name)) {
      // Acknowledge but don't process unrecognized events
      return new NextResponse(null, { status: 204 });
    }

    try {
      // Hold the shared workspace fence for the entire webhook mutation chain,
      // including linked action-item/timeline side effects. Removal cannot
      // complete halfway through processing, and a disable/removal that wins
      // first causes this delivery to become an acknowledged no-op.
      const result = await withJiraWorkspaceProviderFence(() =>
        processJiraWebhookEvent(payload as unknown as JiraWebhookPayload)
      );
      return NextResponse.json({ ok: true, ...result });
    } catch (error) {
      if (isWorkspaceUnavailable(error)) {
        logger.info('Jira webhook lost workspace lifecycle race; acknowledged without processing', {
          component: 'jira-webhook',
        });
        return NextResponse.json({
          ok: true,
          updated: 0,
          reason: 'integration_disabled_or_removed',
        });
      }
      throw error;
    }
  } catch (error) {
    logger.error('Jira webhook processing error', {
      component: 'jira-webhook',
      error,
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Webhook processing failed.' },
      { status: 500 }
    );
  }
}

export const POST = withRequestContext(postJiraWebhook, 'api.jira.webhook');
