import { SettingsPageSkeleton } from '@/components/patterns';

export default function IntegrationsLoading() {
  return (
    <SettingsPageSkeleton label="Loading integrations" variant="cards" rows={5} statsCount={1} />
  );
}
