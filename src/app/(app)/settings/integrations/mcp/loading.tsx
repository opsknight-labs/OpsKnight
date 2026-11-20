import { SettingsPageSkeleton } from '@/components/patterns';

export default function LoadingMcp() {
  return (
    <SettingsPageSkeleton
      label="Loading AI assistant settings"
      statsCount={4}
      tabs
      sections={1}
      rows={4}
    />
  );
}
