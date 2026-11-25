import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StatusPageIncidentView } from '@/components/status-page/StatusPageIncidentView';
import { findPublicIncident, getOpenStatusSnapshot } from '@/lib/status-pages/public-access';

export const revalidate = 30;

type Params = { params: Promise<{ slug: string; id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, id } = await params;
  const snapshot = await getOpenStatusSnapshot(slug);
  const incident = snapshot && findPublicIncident(snapshot, id);
  if (!snapshot || !incident) return { title: 'Not found', robots: { index: false } };
  const title = `${incident.title ?? 'Incident'} · ${snapshot.page.name}`;
  const description =
    incident.description?.slice(0, 200) ?? `Incident report for ${snapshot.page.name}`;
  return { title, description, openGraph: { title, description, type: 'article' } };
}

/** Public incident permalink. Reads the published snapshot only, so redaction rules carry over. */
export default async function IncidentPermalinkPage({ params }: Params) {
  const { slug, id } = await params;
  const snapshot = await getOpenStatusSnapshot(slug);
  const incident = snapshot && findPublicIncident(snapshot, id);
  if (!snapshot || !incident) notFound();
  return (
    <StatusPageIncidentView
      snapshot={snapshot}
      incident={incident}
      basePath={`/status/${encodeURIComponent(slug)}`}
    />
  );
}
