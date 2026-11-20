import { ListPageSkeleton } from '@/components/patterns';

export default function ActionItemsLoading() {
  return <ListPageSkeleton label="Loading action items" stats={5} chips={4} rows={8} columns={5} />;
}
