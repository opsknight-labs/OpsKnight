import { ListPageSkeleton } from '@/components/patterns';

/** Catalog: up to three header stats, eight health chips, seven default columns. */
export default function BusinessServicesLoading() {
  return (
    <ListPageSkeleton label="Loading business services" stats={3} actions chips={8} columns={7} />
  );
}
