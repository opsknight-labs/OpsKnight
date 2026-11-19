import prisma from '@/lib/prisma';

/** Whether an admin has allowed outgoing service webhooks to use http:// URLs. Defaults to HTTPS-only. */
export async function allowsInsecureWebhookUrls(): Promise<boolean> {
  const settings = await prisma.systemSettings.findUnique({
    where: { id: 'default' },
    select: { allowInsecureWebhookUrls: true },
  });
  return settings?.allowInsecureWebhookUrls ?? false;
}
