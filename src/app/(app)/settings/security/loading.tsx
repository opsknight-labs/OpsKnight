import { SettingsPageSkeleton } from '@/components/patterns';

export default function SecurityLoading() {
  return <SettingsPageSkeleton label="Loading security settings" sections={3} statsCount={3} />;
}
