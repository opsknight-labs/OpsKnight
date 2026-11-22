import { ListPageSkeleton } from '@/components/patterns';

export default function AlertsLoading() {
  return <ListPageSkeleton label="Loading alerts" stats={4} actions chips={5} columns={6} />;
}
