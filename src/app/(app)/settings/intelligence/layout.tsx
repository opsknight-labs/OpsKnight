import React from 'react';
import IntelligenceSubNav from '@/components/settings/layout/IntelligenceSubNav';

export default function IntelligenceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <IntelligenceSubNav />
      <div>{children}</div>
    </div>
  );
}
