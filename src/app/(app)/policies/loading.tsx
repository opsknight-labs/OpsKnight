import { ListPageSkeleton } from '@/components/patterns';

export default function PoliciesLoading() {
  return <ListPageSkeleton label="Loading escalation policies" stats={3} rows={6} columns={5} />;
}
