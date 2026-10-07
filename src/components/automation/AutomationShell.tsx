'use client';
import dynamic from 'next/dynamic';
const AutomationWorkspace = dynamic(() => import('./AutomationWorkspace'), {
  loading: () => <p className="text-sm text-muted-foreground">Loading automation…</p>,
  ssr: false,
});
export default function AutomationShell({ serviceId }: { serviceId: string }) {
  return <AutomationWorkspace serviceId={serviceId} />;
}
