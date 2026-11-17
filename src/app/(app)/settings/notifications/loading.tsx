import SettingsPageSkeleton from '@/components/settings/layout/SettingsPageSkeleton';

export default function NotificationsLoading() {
  return (
    <SettingsPageSkeleton
      label="Loading notification providers"
      variant="cards"
      rows={4}
      statsCount={4}
    />
  );
}
