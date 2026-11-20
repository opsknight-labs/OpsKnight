import { DetailPageSkeleton } from '@/components/patterns';

export default function PolicyDetailLoading() {
  return <DetailPageSkeleton label="Loading escalation policy" stats={3} />;
}
