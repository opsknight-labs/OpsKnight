'use client';

import { useState, useTransition } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Globe, Lock, Loader2, Shield } from 'lucide-react';
import { updateServiceDefaultVisibility } from '@/app/(app)/services/actions';
import { notify } from '@/lib/toast';
import { cn } from '@/lib/utils';

interface ServiceVisibilitySettingsProps {
  serviceId: string;
  defaultIncidentVisibility: 'PUBLIC' | 'PRIVATE';
  canManage: boolean;
}

export default function ServiceVisibilitySettings({
  serviceId,
  defaultIncidentVisibility: initialVisibility,
  canManage,
}: ServiceVisibilitySettingsProps) {
  const [selectedVisibility, setSelectedVisibility] = useState<'PUBLIC' | 'PRIVATE'>(
    initialVisibility || 'PUBLIC'
  );
  const [savedVisibility, setSavedVisibility] = useState<'PUBLIC' | 'PRIVATE'>(
    initialVisibility || 'PUBLIC'
  );
  const [isPending, startTransition] = useTransition();

  const isDirty = selectedVisibility !== savedVisibility;

  const handleSave = () => {
    if (!isDirty || !canManage || isPending) return;

    startTransition(async () => {
      try {
        await updateServiceDefaultVisibility(serviceId, selectedVisibility);
        setSavedVisibility(selectedVisibility);
        notify.success(
          `Default incident visibility updated to ${selectedVisibility === 'PUBLIC' ? 'Public' : 'Private'}`
        );
      } catch (error) {
        notify.error(
          error instanceof Error ? error.message : 'Failed to update visibility setting'
        );
      }
    });
  };

  return (
    <Card className="rounded-xl border border-border/80 bg-card/90 shadow-xs">
      <CardHeader className="px-3.5 py-2.5 border-b border-border/60 bg-muted/20">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0 border border-primary/20">
              <Shield className="h-3.5 w-3.5" />
            </div>
            <div>
              <CardTitle className="text-xs sm:text-sm font-bold flex items-center gap-1.5">
                <span>Default Incident Visibility</span>
              </CardTitle>
              <CardDescription className="text-[11px] leading-tight">
                Initial visibility state for newly ingested alerts and incidents on this service.
              </CardDescription>
            </div>
          </div>
          <Badge
            variant="outline"
            className={cn(
              'text-[10px] font-semibold w-fit px-2 py-0.5 shrink-0',
              savedVisibility === 'PUBLIC'
                ? 'border-sky-500/40 text-sky-600 dark:text-sky-400 bg-sky-500/10'
                : 'border-slate-500/40 text-slate-700 dark:text-slate-300 bg-slate-500/10'
            )}
          >
            {savedVisibility === 'PUBLIC' ? 'Default: Public' : 'Default: Private'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-3.5 sm:p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {/* Public Option */}
          <button
            type="button"
            disabled={!canManage || isPending}
            onClick={() => setSelectedVisibility('PUBLIC')}
            className={cn(
              'flex items-center gap-2.5 p-2.5 rounded-lg border text-left transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-60',
              selectedVisibility === 'PUBLIC'
                ? 'border-sky-500/50 bg-sky-500/10 ring-1 ring-sky-500/30 shadow-2xs'
                : 'border-border/80 bg-card hover:bg-muted/50 hover:border-border text-muted-foreground'
            )}
          >
            <div
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border',
                selectedVisibility === 'PUBLIC'
                  ? 'border-sky-500/40 bg-sky-500/20 text-sky-600 dark:text-sky-400'
                  : 'border-border/80 bg-muted/50 text-muted-foreground'
              )}
            >
              <Globe className="h-3.5 w-3.5 shrink-0" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs font-bold text-foreground">Customer-Facing Outage</span>
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[9px] font-semibold px-1.5 py-0',
                    selectedVisibility === 'PUBLIC'
                      ? 'border-sky-500/40 text-sky-600 dark:text-sky-400 bg-sky-500/10'
                      : 'opacity-60'
                  )}
                >
                  PUBLIC
                </Badge>
              </div>
              <p className="text-[10px] text-muted-foreground leading-snug truncate mt-0.5">
                Visible on status pages & client broadcasts by default.
              </p>
            </div>
          </button>

          {/* Private Option */}
          <button
            type="button"
            disabled={!canManage || isPending}
            onClick={() => setSelectedVisibility('PRIVATE')}
            className={cn(
              'flex items-center gap-2.5 p-2.5 rounded-lg border text-left transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-60',
              selectedVisibility === 'PRIVATE'
                ? 'border-slate-500/50 bg-slate-500/10 ring-1 ring-slate-500/30 shadow-2xs'
                : 'border-border/80 bg-card hover:bg-muted/50 hover:border-border text-muted-foreground'
            )}
          >
            <div
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border',
                selectedVisibility === 'PRIVATE'
                  ? 'border-slate-500/40 bg-slate-500/20 text-slate-700 dark:text-slate-300'
                  : 'border-border/80 bg-muted/50 text-muted-foreground'
              )}
            >
              <Lock className="h-3.5 w-3.5 shrink-0" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs font-bold text-foreground">Internal System Only</span>
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[9px] font-semibold px-1.5 py-0',
                    selectedVisibility === 'PRIVATE'
                      ? 'border-slate-500/40 text-slate-700 dark:text-slate-300 bg-slate-500/10'
                      : 'opacity-60'
                  )}
                >
                  PRIVATE
                </Badge>
              </div>
              <p className="text-[10px] text-muted-foreground leading-snug truncate mt-0.5">
                Internal only; hidden from public status pages until promoted.
              </p>
            </div>
          </button>
        </div>

        {canManage && (
          <div className="pt-2 flex items-center justify-between border-t border-border/40">
            <p className="text-[11px] text-muted-foreground">
              {isDirty
                ? 'Unsaved changes. Click save to apply.'
                : 'Applies to all newly ingested manual & alert incidents.'}
            </p>
            <Button
              type="button"
              size="sm"
              disabled={!isDirty || isPending}
              onClick={handleSave}
              className="h-8 text-xs font-semibold px-3.5"
            >
              {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {isPending ? 'Saving...' : 'Save Visibility'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
