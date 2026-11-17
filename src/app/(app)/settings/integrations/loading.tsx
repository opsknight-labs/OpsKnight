import SettingsPageSkeleton from '@/components/settings/layout/SettingsPageSkeleton';

export default function IntegrationsLoading() {
  return (
    <SettingsPageSkeleton label="Loading integrations" variant="cards" rows={5} statsCount={1} />
  );
}
