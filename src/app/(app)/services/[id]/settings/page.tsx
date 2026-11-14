import { redirect } from 'next/navigation';
import { requirePageAccess } from '@/lib/access/server';

export default async function ServiceSettingsRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ saved?: string; error?: string }>;
}) {
  await requirePageAccess('/services/[id]/settings');
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const queryString = new URLSearchParams();
  queryString.set('tab', 'settings');
  if (resolvedSearchParams?.saved) queryString.set('saved', resolvedSearchParams.saved);
  if (resolvedSearchParams?.error) queryString.set('error', resolvedSearchParams.error);

  redirect(`/services/${id}?${queryString.toString()}`);
}
