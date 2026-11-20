import { SettingsPageSkeleton } from '@/components/patterns';

export default function AccessLoading() {
  return <SettingsPageSkeleton label="Loading access" sections={2} statsCount={4} />;
}
