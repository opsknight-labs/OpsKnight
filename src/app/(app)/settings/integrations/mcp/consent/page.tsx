import { redirect } from 'next/navigation';
import { requirePageAccess } from '@/lib/access/server';

export const dynamic = 'force-dynamic';

/** Consent moved to a focused page outside the settings shell; keep in-flight links working. */
export default async function LegacyMcpConsent({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  await requirePageAccess('/settings/integrations/mcp/consent');
  const { id } = await searchParams;
  redirect(`/oauth/mcp/consent${id && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? `?id=${id}` : ''}`);
}
