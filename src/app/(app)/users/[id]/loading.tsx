import { DetailPageSkeleton } from '@/components/patterns';

export default function UserDetailLoading() {
  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6 md:px-6 md:py-8">
      <DetailPageSkeleton label="Loading user" />
    </div>
  );
}
