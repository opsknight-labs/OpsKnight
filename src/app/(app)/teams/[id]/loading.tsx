import { DetailPageSkeleton } from '@/components/patterns';

export default function TeamDetailLoading() {
  return <DetailPageSkeleton label="Loading team" stats={3} tabs={3} />;
}
