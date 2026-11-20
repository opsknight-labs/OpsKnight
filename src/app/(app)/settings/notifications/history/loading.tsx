import { SettingsPageSkeleton } from '@/components/patterns';

export default function NotificationHistoryLoading() {
  return (
    <SettingsPageSkeleton
      label="Loading delivery history"
      variant="table"
      rows={8}
      statsCount={4}
    />
  );
}
