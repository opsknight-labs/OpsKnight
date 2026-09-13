import IncidentDetailScreen from '@/components/incident/IncidentDetailScreen';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function MobileIncidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <IncidentDetailScreen id={id} backHref="/m/incidents" presentation="mobile" />;
}
