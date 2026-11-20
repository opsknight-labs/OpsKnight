import { SettingsPageSkeleton } from '@/components/patterns';

export default function IncidentSlaLoading() {
  return <SettingsPageSkeleton label="Loading incident response policy" statsCount={3} tabs />;
}
