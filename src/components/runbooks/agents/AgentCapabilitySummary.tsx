import React from 'react';
import { Badge } from '@/components/ui/shadcn/badge';

export function AgentCapabilitySummary({
  capabilities,
}: {
  capabilities: unknown;
}) {
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const items = capabilities
    .filter((v): v is string => typeof v === 'string')
    .slice(0, 4);

  return (
    <div className="flex flex-wrap gap-1" aria-label="Configured capabilities">
      {items.map(cap => {
        const cleanName = cap.replace('RUNBOOK_', '').replaceAll('_', ' ');
        return (
          <Badge
            key={cap}
            variant="outline"
            className="px-1.5 py-0 text-[10px] font-mono tracking-tight bg-muted/30"
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
