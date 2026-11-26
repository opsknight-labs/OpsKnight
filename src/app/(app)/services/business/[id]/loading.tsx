import { DetailPageSkeleton } from '@/components/patterns';

/** Detail: four header stats and up to six tabs. */
export default function BusinessServiceLoading() {
  return <DetailPageSkeleton label="Loading the business service" stats={4} tabs={6} />;
}
