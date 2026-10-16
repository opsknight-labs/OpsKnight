import React from 'react';
import { Badge } from '@/components/ui/shadcn/badge';

export function AgentCapabilitySummary({ capabilities }: { capabilities: unknown }) {
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const items = capabilities.filter((v): v is string => typeof v === 'string').slice(0, 4);

  return (
    <div className="flex flex-wrap gap-1" aria-label="Configured capabilities">
      {items.map(cap => {
        const cleanName = cap.replace('RUNBOOK_', '').replaceAll('_', ' ');
        return (
          <Badge
            key={cap}
            variant="outline"
            className="rounded-full bg-muted/40 px-2 py-0 font-mono text-[10px] font-medium tracking-tight text-muted-foreground"
          >
            {cleanName}
          </Badge>
        );
      })}
      {capabilities.length > 4 && (
        <span className="text-[10px] text-muted-foreground font-mono self-center">
          +{capabilities.length - 4}
        </span>
      )}
    </div>
  );
}
