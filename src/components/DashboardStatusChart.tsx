'use client';

import { useRouter, usePathname } from 'next/navigation';
import PieChart from '@/components/analytics/PieChart';

type StatusChartProps = {
  data: Array<{ label: string; value: number; color: string }>;
};

export default function DashboardStatusChart({ data }: StatusChartProps) {
  const router = useRouter();
  const pathname = usePathname();

  const handleSegmentClick = (segment: { label: string; value: number; color: string }) => {
    // Map status labels to status values
    const statusMap: { [key: string]: string } = {
      'Open': 'OPEN',
      'Acknowledged': 'ACKNOWLEDGED',
      'Resolved': 'RESOLVED',
      'Snoozed': 'SNOOZED',
      'Suppressed': 'SUPPRESSED'
    };

    const status = statusMap[segment.label];
    if (status) {
      const params = new URLSearchParams(window.location.search);
      params.set('status', status);
      params.delete('page'); // Reset to page 1
      router.push(`${pathname}?${params.toString()}`);
    }
  };

  return (
    <PieChart 
      data={data} 
      size={140} 
      showLegend={false}
      onSegmentClick={handleSegmentClick}
    />
  );
}

