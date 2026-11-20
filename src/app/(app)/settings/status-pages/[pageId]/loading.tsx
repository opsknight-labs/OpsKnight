import { SettingsPageSkeleton } from '@/components/patterns';

export default function StatusPageDetailLoading() {
  return <SettingsPageSkeleton label="Loading status page" sections={2} statsCount={4} tabs />;
}
