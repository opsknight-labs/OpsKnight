import { createHash } from 'node:crypto';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { decryptStoredSecret, encrypt, isEncryptedSecret } from '@/lib/encryption';

/**
 * Service.slackWebhookUrl is a bearer secret (anyone holding the URL can post to the channel), so it
 * is stored encrypted. Every reader goes through `readSlackWebhookUrl`, which accepts both the legacy
 * plaintext and the encrypted form; every writer goes through `storeSlackWebhookUrl`. A maintenance
 * step (`reencryptSlackWebhookUrls`) converts the remaining plaintext rows.
 */
export async function readSlackWebhookUrl(
  stored: string | null | undefined
): Promise<string | undefined> {
  const value = stored?.trim();
  return value ? decryptStoredSecret(value) : undefined;
}

export function storeSlackWebhookUrl(url: string): Promise<string> {
  return encrypt(url);
}

/**
 * A non-secret handle for one webhook URL. Notification rows carry this instead of the URL, so the
 * queue never holds a usable secret and delivery can still tell that the webhook was replaced.
 */
export function slackWebhookHandle(url: string): string {
  return `slack-webhook:${createHash('sha256').update(url, 'utf8').digest('hex').slice(0, 16)}`;
}

export const SLACK_WEBHOOK_REENCRYPT_BATCH = 100;
export const SLACK_WEBHOOK_REENCRYPT_MAX_BATCHES = 10;

/**
 * Encrypt the plaintext webhook rows left from before encryption, 100 per batch and at most 10
 * batches per run. Idempotent: an encrypted row is never selected, and each write only applies if the
 * value is still the one that was read, so a concurrent edit is never overwritten.
 */
export async function reencryptSlackWebhookUrls(): Promise<number> {
  let converted = 0;
  let cursor: string | undefined;
  for (let batch = 0; batch < SLACK_WEBHOOK_REENCRYPT_MAX_BATCHES; batch++) {
    const rows = await prisma.service.findMany({
      // Only plaintext rows: a URL contains "://", no encrypted format does, so converted rows drop out.
      where: { slackWebhookUrl: { contains: '://' }, ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true, slackWebhookUrl: true },
      orderBy: { id: 'asc' },
      take: SLACK_WEBHOOK_REENCRYPT_BATCH,
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    for (const row of rows) {
      const current = row.slackWebhookUrl;
      if (!current?.trim() || isEncryptedSecret(current)) continue;
      const result = await prisma.service.updateMany({
        where: { id: row.id, slackWebhookUrl: current },
        data: { slackWebhookUrl: await storeSlackWebhookUrl(current.trim()) },
      });
      converted += result.count;
    }
    if (rows.length < SLACK_WEBHOOK_REENCRYPT_BATCH) break;
  }
  if (converted > 0) logger.info('slack_webhook.reencrypted', { count: converted });
  return converted;
}
