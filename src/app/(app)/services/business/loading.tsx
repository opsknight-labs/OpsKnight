import { ListPageSkeleton } from '@/components/patterns';

export default function BusinessServicesLoading() {
  return (
    <ListPageSkeleton label="Loading business services" stats={4} actions chips={6} columns={6} />
  );
}
