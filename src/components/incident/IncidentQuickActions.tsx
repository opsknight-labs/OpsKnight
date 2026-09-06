'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/shadcn/button';
import { Server, BarChart3, ExternalLink } from 'lucide-react';

type IncidentQuickActionsProps = {
  incidentId: string;
  serviceId: string;
};

export default function IncidentQuickActions({ incidentId, serviceId }: IncidentQuickActionsProps) {
  return (
    <div className="flex gap-2 flex-wrap">
      <Link href={`/services/${serviceId}`}>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs font-semibold border-[var(--border)] hover:border-[var(--primary)] hover:bg-[var(--primary)]/5 transition-all group"
        >
          <Server className="h-3.5 w-3.5 mr-1.5 text-[var(--accent)]" />
          Service
          <ExternalLink className="h-3 w-3 ml-1.5 opacity-40 group-hover:opacity-100 transition-opacity" />
        </Button>
      </Link>
      <Link href={`/analytics?incident=${incidentId}`}>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs font-semibold border-[var(--border)] hover:border-[var(--primary)] hover:bg-[var(--primary)]/5 transition-all group"
        >
          <BarChart3 className="h-3.5 w-3.5 mr-1.5 text-[var(--accent)]" />
          Analytics
          <ExternalLink className="h-3 w-3 ml-1.5 opacity-40 group-hover:opacity-100 transition-opacity" />
        </Button>
      </Link>
    </div>
  );
}
