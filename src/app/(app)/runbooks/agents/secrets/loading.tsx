import { ListPageSkeleton } from '@/components/patterns';

export default function AgentSecretsLoading() {
  return <ListPageSkeleton label="Loading scoped secrets" stats={3} rows={5} columns={4} />;
}
