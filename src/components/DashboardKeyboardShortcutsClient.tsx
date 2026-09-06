'use client';

import DashboardKeyboardShortcuts from '@/components/DashboardKeyboardShortcuts';

export default function DashboardKeyboardShortcutsClient() {
  return (
    <DashboardKeyboardShortcuts
      onRefresh={() => window.location.reload()}
      onExport={() => {
        // Trigger export programmatically
        const exportButton = document.querySelector('[title="Export dashboard data to CSV"]') as HTMLButtonElement | null;
        exportButton?.click();
      }}
    />
  );
}
