import SettingsPageSkeleton from '@/components/settings/layout/SettingsPageSkeleton';

export default function PrivacyRequestsLoading() {
  return (
    <SettingsPageSkeleton
      label="Loading privacy requests"
      variant="table"
      rows={6}
      statsCount={3}
    />
  );
}
