import { DashboardPageSkeleton } from '@/components/patterns';

export default function ReportsLoading() {
  return <DashboardPageSkeleton label="Loading reports" stats={4} actions panels={6} />;
}
