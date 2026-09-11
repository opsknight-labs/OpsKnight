import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { decrypt } from '@/lib/encryption';
import { isAppError } from '@/lib/errors';
import { processJiraWebhookEvent, type JiraWebhookPayload } from '@/lib/jira-sync';
import {
  withJiraIssueMutationFence,
  withJiraWorkspaceProviderFence,
} from '@/lib/jira-concurrency';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger, withRequestContext } from '@/lib/logger';
import { getClientIp } from '@/lib/client-ip';
import {
  claimInboundDelivery,
  completeInboundDelivery,
  failInboundDelivery,
  readIntegrationBody,
  type InboundDeliveryClaim,
} from '@/lib/integrations/request-security';

const JIRA_INBOUND_INTEGRATION_ID = 'jira:default';

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

type ParsedJiraWebhook = z.infer<typeof JiraWebhookSchema>;

/**
 * Build a durable delivery identity from a real provider nonce whenever Jira
 * supplies one. Older Jira variants do not expose that header consistently, so
 * fall back to stable domain identifiers rather than unsafe whole-body hashes.
 */
export function getJiraWebhookDeliveryId(
  payload: ParsedJiraWebhook,
  providerDeliveryId?: string | null
): string | null {
  const providerNonce = providerDeliveryId?.trim();
  if (providerNonce) return `provider:${providerNonce}`;

  const issueIdentity = payload.issue?.id?.trim() || payload.issue?.key?.trim();
  if (!issueIdentity) return null;

  const event = (payload.webhookEvent || payload.issue_event_type_name || 'issue_event')
    .trim()
    .toLowerCase();
  const changelogId = payload.changelog?.id?.trim();
  if (changelogId) return `${event}:${issueIdentity}:changelog:${changelogId}`;

  const commentId = payload.comment?.id?.trim();
  if (commentId) return `${event}:${issueIdentity}:comment:${commentId}`;

  if (payload.timestamp !== undefined && payload.timestamp !== null) {
    return `${event}:${issueIdentity}:timestamp:${String(payload.timestamp)}`;
  }

  return null;
}

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

async function completeClaim(claim: InboundDeliveryClaim | null): Promise<void> {
  if (claim?.disposition === 'CLAIMED') await completeInboundDelivery(claim);
}

async function failClaim(claim: InboundDeliveryClaim | null, error: unknown): Promise<void> {
  if (claim?.disposition === 'CLAIMED') await failInboundDelivery(claim, error);
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

    const claim = await claimInboundDelivery(
      JIRA_INBOUND_INTEGRATION_ID,
      'JIRA',
      getJiraWebhookDeliveryId(
        payload,
        request.headers.get('x-atlassian-webhook-identifier')
      )
    );
    if (claim?.disposition === 'COMPLETED') {
      return NextResponse.json({ ok: true, updated: 0, reason: 'duplicate_delivery' });
    }
    if (claim?.disposition === 'BUSY') {
      // Do not acknowledge an in-flight duplicate as successfully committed.
      // If the active worker crashes after this request returns, Jira must have
      // a reason to retry after the durable lease expires.
      return NextResponse.json(
        { error: 'Jira delivery is already being processed.' },
        { status: 503, headers: { 'Retry-After': '5' } }
      );
    }

    try {
      const issueFenceKey = (
        payload.issue?.key?.trim() || payload.issue?.id?.trim() || 'unknown'
      ).toUpperCase();

      // The workspace fence coordinates disable/remove, while the issue fence
      // serializes same-issue stale-check/update/side-effect chains across
      // replicas. Webhook processing performs no provider HTTP under the issue
      // lock, keeping the DB transaction short and deterministic.
      const result = await withJiraWorkspaceProviderFence(() =>
        withJiraIssueMutationFence('JIRA', issueFenceKey, () =>
          processJiraWebhookEvent(payload as unknown as JiraWebhookPayload)
        )
      );
      await completeClaim(claim);
      return NextResponse.json({ ok: true, ...result });
    } catch (error) {
      if (isWorkspaceUnavailable(error)) {
        logger.info('Jira webhook lost workspace lifecycle race; acknowledged without processing', {
          component: 'jira-webhook',
        });
        await completeClaim(claim);
        return NextResponse.json({
          ok: true,
          updated: 0,
          reason: 'integration_disabled_or_removed',
        });
      }
      await failClaim(claim, error);
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
