import AnalyticsSkeleton from '@/components/analytics/AnalyticsSkeleton';

export default function AnalyticsLoading() {
  return (
    <div className="w-full px-4 py-6 [zoom:0.8]">
      <AnalyticsSkeleton />
    </div>
  );
}
