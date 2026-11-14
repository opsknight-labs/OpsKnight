import { redirect } from 'next/navigation';
import { requirePageAccess } from '@/lib/access/server';

export default async function ServiceIntegrationsRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePageAccess('/services/[id]/integrations');
  const { id } = await params;
  redirect(`/services/${id}?tab=integrations`);
}
