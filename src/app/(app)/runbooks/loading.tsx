import { ListPageSkeleton } from '@/components/patterns';

export default function RunbooksLoading() {
  return (
    <ListPageSkeleton label="Loading runbook library" stats={4} actions rows={8} columns={5} />
  );
}
