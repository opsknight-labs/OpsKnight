import { ListPageSkeleton } from '@/components/patterns';

export default function ChangesLoading() {
  return <ListPageSkeleton label="Loading changes" stats={4} actions chips={5} columns={6} />;
}
