import IncidentDetailScreen from '@/components/incident/IncidentDetailScreen';
import { requirePageAccess } from '@/lib/access/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function MobileIncidentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ tab?: string }>;
}) {
  await requirePageAccess('/m/incidents/[id]');
  const [{ id }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams ? searchParams : Promise.resolve(undefined),
  ]);
  return (
    <IncidentDetailScreen
      id={id}
      backHref="/m/incidents"
      presentation="mobile"
      initialTab={resolvedSearchParams?.tab}
    />
  );
}
