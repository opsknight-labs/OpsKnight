import { SettingsPageSkeleton } from '@/components/patterns';

export default function CustomFieldsLoading() {
  return (
    <SettingsPageSkeleton label="Loading custom fields" variant="table" rows={5} statsCount={4} />
  );
}
