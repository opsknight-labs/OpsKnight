import { redirect } from 'next/navigation';

/** Shareable address of a service's Intelligence tab; the tab itself lives on the service page. */
export default async function ServiceIntelligenceRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/services/${encodeURIComponent(id)}?tab=intelligence`);
}
