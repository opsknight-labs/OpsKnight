import { DetailPageSkeleton } from '@/components/patterns';

export default function ExecutionDetailLoading() {
  return <DetailPageSkeleton label="Loading execution" stats={5} />;
}
