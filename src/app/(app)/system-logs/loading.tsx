import LogPageSkeleton from '@/components/audit/LogPageSkeleton';

export default function SystemLogsLoading() {
  return <LogPageSkeleton label="Loading system logs" statsCount={4} columns={5} />;
}
