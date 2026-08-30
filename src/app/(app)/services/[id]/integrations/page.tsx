import { redirect } from 'next/navigation';

export default async function ServiceIntegrationsRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/services/${id}?tab=integrations`);
}
