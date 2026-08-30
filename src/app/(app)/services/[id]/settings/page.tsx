import { redirect } from 'next/navigation';

export default async function ServiceSettingsRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ saved?: string; error?: string }>;
}) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const queryString = new URLSearchParams();
  queryString.set('tab', 'settings');
  if (resolvedSearchParams?.saved) queryString.set('saved', resolvedSearchParams.saved);
  if (resolvedSearchParams?.error) queryString.set('error', resolvedSearchParams.error);

  redirect(`/services/${id}?${queryString.toString()}`);
}
