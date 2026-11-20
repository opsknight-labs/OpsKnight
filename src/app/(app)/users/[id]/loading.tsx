import { DetailPageSkeleton } from '@/components/patterns';

export default function UserDetailLoading() {
  return <DetailPageSkeleton label="Loading user" stats={3} tabs={3} />;
}
