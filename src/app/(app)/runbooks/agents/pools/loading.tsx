import { ListPageSkeleton } from '@/components/patterns';

export default function AgentPoolsLoading() {
  return <ListPageSkeleton label="Loading agent pools" stats={3} rows={6} columns={4} />;
}
