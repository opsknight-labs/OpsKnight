'use client';

import DashboardStatusChart from './DashboardStatusChart';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

type UrgencyDistributionData = {
  label: string;
  value: number;
  color: string;
};

type DashboardUrgencyDistributionProps = {
  data: UrgencyDistributionData[];
};

export default function DashboardUrgencyDistribution({ data }: DashboardUrgencyDistributionProps) {
  const total = data.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="p-0">
      {total === 0 ? (
        <div className="p-8 text-center text-muted-foreground text-sm">
          <AlertTriangle className="h-8 w-8 opacity-30 mx-auto mb-2" />
          <p className="m-0">No urgency data available</p>
        </div>
      ) : (
        <>
          <div className="mb-4">
            <DashboardStatusChart data={data} />
          </div>
          <div className="flex flex-col gap-2">
            {data.map(item => {
              const percentage = total > 0 ? ((item.value / total) * 100).toFixed(1) : '0';
              return (
                <div
                  key={item.label}
                  className={cn(
                    'flex justify-between items-center text-sm px-3 py-2',
                    'bg-neutral-50 rounded-lg border border-border',
                    'transition-all duration-200 hover:shadow-sm hover:-translate-y-0.5'
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-3 h-3 rounded-full border-2 border-white shadow-[0_0_0_1px_var(--border)]"
                      style={{ background: item.color }}
                    />
                    <span className="font-semibold text-foreground">{item.label}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{percentage}%</span>
                    <span
                      className="font-bold min-w-[2.5rem] text-right"
                      style={{ color: item.color }}
                    >
                      {item.value}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
