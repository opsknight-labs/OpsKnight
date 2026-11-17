import LogPageSkeleton from '@/components/audit/LogPageSkeleton';

export default function EventsLoading() {
  return <LogPageSkeleton label="Loading event logs" filterCount={1} columns={5} />;
}
