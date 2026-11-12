import IncidentDetailScreen from '@/components/incident/IncidentDetailScreen';
import { requirePageAccess } from '@/lib/access/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function IncidentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ tab?: string }>;
}) {
  await requirePageAccess('/incidents/[id]');
  const [{ id }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams ? searchParams : Promise.resolve(undefined),
  ]);
  return (
    <IncidentDetailScreen
      id={id}
      backHref="/incidents"
      presentation="desktop"
      initialTab={resolvedSearchParams?.tab}
    />
  );
}
