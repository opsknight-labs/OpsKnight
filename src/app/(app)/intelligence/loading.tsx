import { DashboardPageSkeleton } from '@/components/patterns';

export default function IntelligenceOverviewLoading() {
  return <DashboardPageSkeleton label="Loading the AIOps overview" stats={4} panels={4} />;
}
