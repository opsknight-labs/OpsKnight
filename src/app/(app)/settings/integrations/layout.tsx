import React from 'react';
import IntegrationsSubNav from '@/components/settings/layout/IntegrationsSubNav';

export default function IntegrationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <IntegrationsSubNav />
      <div>{children}</div>
    </div>
  );
}
