import type { Metadata } from 'next';
import AccessDeniedView from '@/components/access/AccessDeniedView';
import { explainAccessForCurrentPath } from '@/lib/access/server';

export const metadata: Metadata = { title: 'Access denied' };

export default async function RootForbidden() {
  return (
    <main className="min-h-screen bg-background">
      <AccessDeniedView explanation={await explainAccessForCurrentPath()} />
    </main>
  );
}
