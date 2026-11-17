import SettingsPageSkeleton from '@/components/settings/layout/SettingsPageSkeleton';

export default function CustomFieldsLoading() {
  return (
    <SettingsPageSkeleton label="Loading custom fields" variant="table" rows={5} statsCount={4} />
  );
}
