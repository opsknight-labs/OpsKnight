import { SettingsPageSkeleton } from '@/components/patterns';

export default function ApiKeysLoading() {
  return (
    <SettingsPageSkeleton label="Loading API keys" variant="table" rows={5} statsCount={3} tabs />
  );
}
