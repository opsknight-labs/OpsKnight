import SettingsPageSkeleton from '@/components/settings/layout/SettingsPageSkeleton';

export default function ServiceObjectivesLoading() {
  return (
    <SettingsPageSkeleton
      label="Loading service objectives"
      variant="table"
      rows={6}
      statsCount={4}
    />
  );
}
