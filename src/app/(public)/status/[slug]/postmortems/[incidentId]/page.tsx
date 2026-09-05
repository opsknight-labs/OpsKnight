import { renderPublicPostmortem } from '@/app/(public)/status/postmortems/[incidentId]/page';

export default async function SlugPostmortemPage({
  params,
}: {
  params: Promise<{ slug: string; incidentId: string }>;
}) {
  const { slug, incidentId } = await params;
  return renderPublicPostmortem(incidentId, slug);
}
