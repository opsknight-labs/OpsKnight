import PageLoadingSkeleton from '@/components/ui/PageLoadingSkeleton';

export default function IncidentsLoading() {
  return <PageLoadingSkeleton type="list" itemCount={6} />;
}
