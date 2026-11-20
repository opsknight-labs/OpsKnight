import { ListPageSkeleton } from '@/components/patterns';

export default function AgentsLoading() {
  return <ListPageSkeleton label="Loading agent fleet" stats={4} rows={6} columns={5} />;
}
