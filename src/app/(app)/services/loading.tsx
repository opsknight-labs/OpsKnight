import { ListPageSkeleton } from '@/components/patterns';

export default function ServicesLoading() {
  return <ListPageSkeleton label="Loading services" stats={4} rows={10} columns={6} />;
}
