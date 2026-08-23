import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { decrypt } from '@/lib/encryption';
import { processJiraWebhookEvent, type JiraWebhookPayload } from '@/lib/jira-sync';
import { logger } from '@/lib/logger';

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
    const isValid = await verifyWebhookSecret(request);
    if (!isValid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload: JiraWebhookPayload = await request.json();

    const event = payload.webhookEvent;
    if (!event || !HANDLED_EVENTS.has(event)) {
      // Acknowledge but don't process unrecognized events
      return new NextResponse(null, { status: 204 });
    }

    const result = await processJiraWebhookEvent(payload);

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
