import { ListPageSkeleton } from '@/components/patterns';

export default function ExecutionsLoading() {
  return <ListPageSkeleton label="Loading executions" stats={5} rows={8} columns={5} />;
}
