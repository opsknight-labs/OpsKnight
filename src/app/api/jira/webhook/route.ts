import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { decrypt } from '@/lib/encryption';
import { processJiraWebhookEvent, type JiraWebhookPayload } from '@/lib/jira-sync';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

const JiraWebhookSchema = z
  .object({
    webhookEvent: z.string(),
    issue: z
      .object({
        id: z.string().optional(),
        key: z.string().optional(),
        fields: z.record(z.unknown()).optional(),
      })
      .optional(),
    comment: z
      .object({
        id: z.string().optional(),
        body: z.unknown().optional(),
      })
      .optional(),
    timestamp: z.number().optional(),
    user: z.record(z.unknown()).optional(),
  })
  .passthrough();

async function verifyWebhookSecret(request: NextRequest): Promise<boolean> {
  const config = await prisma.jiraConfig.findUnique({
    where: { id: 'default' },
    select: { webhookSecretEncrypted: true },
  });

  if (!config?.webhookSecretEncrypted) {
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

  const secret = await decrypt(config.webhookSecretEncrypted);
  const provided =
    request.headers.get('x-jira-webhook-secret') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    null;

  if (!provided) return false;

  try {
    const { safeCompare } = await import('@/lib/integrations/signature-verification');
    return safeCompare(secret, provided);
  } catch {
    return false;
  }
}

const HANDLED_EVENTS = new Set(['jira:issue_updated', 'jira:issue_deleted']);

export async function POST(request: NextRequest) {
  try {
    const forwardedFor = request.headers.get('x-forwarded-for');
    const clientIp =
      request.headers.get('x-real-ip')?.trim() ||
      forwardedFor
        ?.split(',')
        .map(value => value.trim())
        .filter(Boolean)
        .at(-1) ||
      'unknown';
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

    const isValid = await verifyWebhookSecret(request);
    if (!isValid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = JiraWebhookSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const payload = parsed.data;

    const event = payload.webhookEvent;
    if (!event || !HANDLED_EVENTS.has(event)) {
      // Acknowledge but don't process unrecognized events
      return new NextResponse(null, { status: 204 });
    }

    const result = await processJiraWebhookEvent(payload as unknown as JiraWebhookPayload);

    return NextResponse.json({ ok: true, ...result });
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
