'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import DashboardInteractiveChart from '@/components/DashboardInteractiveChart';

type InteractiveChartClientProps = {
  data: Array<{ key: string; label: string; count: number }>;
  maxValue: number;
  title: string;
  filterType?: 'date' | 'status' | 'service';
};

export default function DashboardInteractiveChartClient({
  data,
  maxValue,
  title,
  filterType = 'date'
}: InteractiveChartClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleDataPointClick = (dataPoint: { key: string; label: string; count: number }) => {
    const params = new URLSearchParams(searchParams.toString());
    
    if (filterType === 'date') {
      // Parse the date from the key (format: YYYY-MM-DD)
      const date = new Date(dataPoint.key);
      const nextDay = new Date(date);
      nextDay.setDate(nextDay.getDate() + 1);
      
      // Set custom date range
      params.set('range', 'custom');
      params.set('startDate', date.toISOString().split('T')[0]);
      params.set('endDate', nextDay.toISOString().split('T')[0]);
    } else if (filterType === 'status') {
      // Filter by status (assuming dataPoint.key is the status)
      params.set('status', dataPoint.key);
    } else if (filterType === 'service') {
      // Filter by service (assuming dataPoint.key is the service ID)
      params.set('service', dataPoint.key);
    }
    
    params.delete('page'); // Reset to page 1
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <DashboardInteractiveChart
      data={data}
      maxValue={maxValue}
      title={title}
      onDataPointClick={handleDataPointClick}
    />
  );
}
