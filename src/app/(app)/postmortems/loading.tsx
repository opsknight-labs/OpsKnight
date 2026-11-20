import { ListPageSkeleton } from '@/components/patterns';

export default function PostmortemsLoading() {
  return <ListPageSkeleton label="Loading postmortems" stats={4} actions rows={6} columns={5} />;
}
