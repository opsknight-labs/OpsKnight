'use client';

import { useState, type ReactNode } from 'react';
import { BarChart3, Table2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Chart with a "Table" alternative, so no value is only readable as a colour or position. */
export default function ChartFrame({
  label,
  chart,
  table,
}: {
  label: string;
  chart: ReactNode;
  table: ReactNode;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const option = (value: 'chart' | 'table', icon: ReactNode, text: string) => (
    <button
      type="button"
      aria-pressed={view === value}
      onClick={() => setView(value)}
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-sm px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        view === value
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {icon}
      {text}
    </button>
  );
  return (
    <div className="min-w-0">
      <div className="mb-3 flex justify-end">
        <div
          role="group"
          aria-label={`${label} view`}
          className="inline-flex rounded-md bg-muted p-0.5"
        >
          {option('chart', <BarChart3 className="h-3.5 w-3.5" aria-hidden />, 'Chart')}
          {option('table', <Table2 className="h-3.5 w-3.5" aria-hidden />, 'Table')}
        </div>
      </div>
      {view === 'chart' ? chart : <div className="max-h-72 overflow-auto">{table}</div>}
    </div>
  );
}
