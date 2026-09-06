'use client';

import { usePathname } from 'next/navigation';

export default function SettingsZoomWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Check if we are in settings but NOT in status-page
  // Using includes to cover sub-routes of status-page as well
  const isStatusPage = pathname?.includes('/settings/status-page');

  if (isStatusPage) {
    return <>{children}</>;
  }

  return <div style={{ zoom: 0.95 }}>{children}</div>;
}
