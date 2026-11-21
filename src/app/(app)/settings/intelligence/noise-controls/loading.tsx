import { SettingsPageSkeleton } from '@/components/patterns';

export default function NoiseControlsLoading() {
  return <SettingsPageSkeleton label="Loading noise controls" variant="table" rows={6} />;
}
