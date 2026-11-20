import { ListPageSkeleton } from '@/components/patterns';

export default function TeamsLoading() {
  return <ListPageSkeleton label="Loading teams" stats={3} rows={8} columns={4} />;
}
