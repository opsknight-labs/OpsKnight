import { SettingsPageSkeleton } from '@/components/patterns';

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
