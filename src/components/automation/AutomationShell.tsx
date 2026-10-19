'use client';
import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/shadcn/skeleton';

function WorkspaceLoading() {
  return (
    <div role="status" className="space-y-4">
      <span className="sr-only">Loading automation…</span>
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="h-11 w-full max-w-md rounded-lg" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

const AutomationWorkspace = dynamic(() => import('./AutomationWorkspace'), {
  loading: WorkspaceLoading,
  ssr: false,
});
export default function AutomationShell({
  serviceId,
  mobile = false,
}: {
  serviceId: string;
  mobile?: boolean;
}) {
  return <AutomationWorkspace serviceId={serviceId} mobile={mobile} />;
}
