import PageLoadingSkeleton from '@/components/ui/PageLoadingSkeleton';

export default function SchedulesLoading() {
  return <PageLoadingSkeleton type="list" itemCount={6} />;
}
