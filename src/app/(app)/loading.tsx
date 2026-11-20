import { DashboardPageSkeleton } from '@/components/patterns';

export default function AppLoading() {
  return <DashboardPageSkeleton label="Loading dashboard" stats={4} panels={3} />;
}
