import { SettingsPageSkeleton } from '@/components/patterns';

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
