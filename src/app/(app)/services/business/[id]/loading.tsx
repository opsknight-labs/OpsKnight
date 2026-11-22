import { DetailPageSkeleton } from '@/components/patterns';

export default function BusinessServiceLoading() {
  return <DetailPageSkeleton label="Loading the business service" stats={5} tabs={5} />;
}
