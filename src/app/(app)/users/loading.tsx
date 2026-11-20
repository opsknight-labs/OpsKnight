import { ListPageSkeleton } from '@/components/patterns';

export default function UsersLoading() {
  return <ListPageSkeleton label="Loading users" stats={4} chips={4} rows={10} columns={5} />;
}
