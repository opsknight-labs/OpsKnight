import { DetailPageSkeleton } from '@/components/patterns';

export default function ScheduleDetailLoading() {
  return <DetailPageSkeleton label="Loading schedule" stats={3} />;
}
