import IncidentDetailScreen from '@/components/incident/IncidentDetailScreen';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function MobileIncidentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ tab?: string }>;
}) {
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
