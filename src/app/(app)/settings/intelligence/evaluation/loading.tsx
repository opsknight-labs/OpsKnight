import { SettingsPageSkeleton } from '@/components/patterns';

export default function IntelligenceInsightsLoading() {
  return <SettingsPageSkeleton label="Loading insights" variant="cards" statsCount={4} />;
}
