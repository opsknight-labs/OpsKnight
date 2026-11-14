import type { Metadata } from 'next';
import AccessDeniedLoader from '@/components/access/AccessDeniedLoader';

export const metadata: Metadata = { title: 'Access denied' };

export default function RootForbidden() {
  return (
    <main className="min-h-screen bg-background">
      <AccessDeniedLoader />
    </main>
  );
}
