import { ListPageSkeleton } from '@/components/patterns';

export default function SchedulesLoading() {
  return <ListPageSkeleton label="Loading schedules" stats={3} rows={6} columns={5} />;
}
