'use client';

import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import {
  ShieldAlert,
  Clock,
  MoreVertical,
  ArrowRight,
  Server,
  Layers,
  User,
  Users,
  Calendar,
} from 'lucide-react';

export type PolicyDirectoryItem = {
  id: string;
  name: string;
  description: string | null;
  stepCount: number;
  serviceCount: number;
  services: { id: string; name: string }[];
  steps: {
    id: string;
    stepOrder: number;
    delayMinutes: number;
    targetType: string;
    targetUser?: { id: string; name: string } | null;
    targetTeam?: { id: string; name: string } | null;
    targetSchedule?: { id: string; name: string } | null;
  }[];
};

type PolicyDirectoryCardProps = {
  policy: PolicyDirectoryItem;
  canManage?: boolean;
};

export default function PolicyDirectoryCard({
  policy,
  canManage: _canManage = false,
}: PolicyDirectoryCardProps) {
  const visibleServices = policy.services.slice(0, 3);
  const remainingServicesCount = policy.services.length - visibleServices.length;

  return (
    <Card className="hover:shadow-md hover:border-primary/40 transition-all group flex flex-col justify-between border-slate-200/80 bg-white">
      <CardContent className="p-5 space-y-4">
        {/* Header: Title, Description & Action Menu */}
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href={`/policies/${policy.id}`}
                className="font-bold text-base text-foreground group-hover:text-primary transition-colors truncate"
              >
                {policy.name}
              </Link>
            </div>
            {policy.description ? (
              <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                {policy.description}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground/60 italic">No description provided</p>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
              >
                <MoreVertical className="h-4 w-4" />
                <span className="sr-only">Actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 text-xs">
              <DropdownMenuItem asChild>
                <Link
                  href={`/policies/${policy.id}`}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <Layers className="h-3.5 w-3.5 text-slate-500" />
                  View & Configure Policy
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Step Flow Breakdown */}
        <div className="bg-slate-50/70 border border-slate-100 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-600">
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-primary" />
              <span>
                {policy.stepCount} Escalation Step{policy.stepCount !== 1 ? 's' : ''}
              </span>
            </span>
            <span className="text-[10px] text-muted-foreground">
              {policy.stepCount === 0
                ? 'No steps defined'
                : `Total duration ~${policy.steps.reduce((acc, s) => acc + s.delayMinutes, 0)}m`}
            </span>
          </div>

          {policy.stepCount > 0 ? (
            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
              {policy.steps.slice(0, 4).map((step, idx) => (
                <div key={step.id || idx} className="flex items-center gap-1">
                  <div className="flex items-center gap-1 bg-white px-2 py-0.5 rounded border border-slate-200 text-[10px] font-medium text-slate-700 shadow-2xs">
                    {step.targetType === 'USER' && <User className="h-2.5 w-2.5 text-blue-500" />}
                    {step.targetType === 'TEAM' && (
                      <Users className="h-2.5 w-2.5 text-emerald-500" />
                    )}
                    {step.targetType === 'SCHEDULE' && (
                      <Calendar className="h-2.5 w-2.5 text-amber-500" />
                    )}
                    <span>
                      {step.targetUser?.name ||
                        step.targetTeam?.name ||
                        step.targetSchedule?.name ||
                        `Step ${idx + 1}`}
                    </span>
                    {step.delayMinutes > 0 && (
                      <span className="text-slate-400 font-mono text-[9px]">
                        +{step.delayMinutes}m
                      </span>
                    )}
                  </div>
                  {idx < Math.min(policy.steps.length - 1, 3) && (
                    <ArrowRight className="h-2.5 w-2.5 text-slate-300 shrink-0" />
                  )}
                </div>
              ))}
              {policy.stepCount > 4 && (
                <span className="text-[10px] text-muted-foreground font-mono">
                  +{policy.stepCount - 4} more
                </span>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-amber-700/80 bg-amber-50/50 px-2 py-1 rounded border border-amber-100/60">
              Needs setup: add at least one notification step
            </p>
          )}
        </div>

        {/* Linked Services Section */}
        <div className="space-y-1.5 pt-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Server className="h-3 w-3" />
            <span>Assigned Services ({policy.serviceCount})</span>
          </div>

          {policy.serviceCount > 0 ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              {visibleServices.map(service => (
                <Link
                  key={service.id}
                  href={`/services/${service.id}`}
                  className="inline-flex"
                  onClick={e => e.stopPropagation()}
                >
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-2 py-0.5 hover:bg-primary/10 hover:text-primary transition-colors cursor-pointer border border-slate-200/60"
                  >
                    {service.name}
                  </Badge>
                </Link>
              ))}
              {remainingServicesCount > 0 && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0.5 text-muted-foreground font-normal"
                >
                  +{remainingServicesCount} more
                </Badge>
              )}
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground/80 flex items-center gap-1">
              <ShieldAlert className="h-3 w-3 text-slate-400" />
              <span>Unassigned (no services routing here)</span>
            </div>
          )}
        </div>

        {/* Card Footer: Detail Link */}
        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
          <span className="text-muted-foreground text-[11px]">
            {policy.serviceCount > 0 ? 'Active routing' : 'Standby'}
          </span>
          <Link
            href={`/policies/${policy.id}`}
            className="font-medium text-primary hover:underline flex items-center gap-1 text-[11px] group-hover:translate-x-0.5 transition-transform"
          >
            Configure Rules
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
