'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/shadcn/skeleton';

// Recharts only loads in the browser, after the rest of the page has rendered.
const placeholder = () => <Skeleton className="h-[264px] w-full" />;

export const VolumeChart = dynamic(() => import('./TrendCharts').then(m => m.VolumeChart), {
  ssr: false,
  loading: placeholder,
});

export const DurationChart = dynamic(() => import('./TrendCharts').then(m => m.DurationChart), {
  ssr: false,
  loading: placeholder,
});

export const InterruptionsChart = dynamic(
  () => import('./TrendCharts').then(m => m.InterruptionsChart),
  { ssr: false, loading: () => <Skeleton className="h-[204px] w-full" /> }
);
