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
    <Card className="border-border shadow-xs">
      <CardHeader className="pb-4 border-b bg-muted/20">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              Default Incident Visibility
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Choose whether new incidents for this service default to public or private. Responders
              can still override this per incident.
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className={cn(
              'text-[10px] font-semibold w-fit px-2.5 py-0.5',
              savedVisibility === 'PUBLIC'
                ? 'border-sky-500/40 text-sky-600 dark:text-sky-400 bg-sky-500/10'
                : 'border-slate-500/40 text-slate-700 dark:text-slate-300 bg-slate-500/10'
            )}
          >
            {savedVisibility === 'PUBLIC' ? 'Default: Public' : 'Default: Private'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Public Option */}
          <button
            type="button"
            disabled={!canManage || isPending}
            onClick={() => setSelectedVisibility('PUBLIC')}
            className={cn(
              'flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-60',
              selectedVisibility === 'PUBLIC'
                ? 'border-sky-500/50 bg-sky-500/10 ring-1 ring-sky-500/30 shadow-2xs'
                : 'border-border/80 bg-card hover:bg-muted/50 hover:border-border text-muted-foreground'
            )}
          >
            <div
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
                selectedVisibility === 'PUBLIC'
                  ? 'border-sky-500/40 bg-sky-500/20 text-sky-600 dark:text-sky-400'
                  : 'border-border/80 bg-muted/50 text-muted-foreground'
              )}
            >
              <Globe className="h-4 w-4 shrink-0" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs font-bold text-foreground">Customer-Facing Outage</span>
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[9px] font-semibold',
                    selectedVisibility === 'PUBLIC'
                      ? 'border-sky-500/40 text-sky-600 dark:text-sky-400 bg-sky-500/10'
                      : 'opacity-60'
                  )}
                >
                  PUBLIC
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
                Incidents default to public. Visible on public status pages & client notification
                broadcasts unless marked private.
              </p>
            </div>
          </button>

          {/* Private Option */}
          <button
            type="button"
            disabled={!canManage || isPending}
            onClick={() => setSelectedVisibility('PRIVATE')}
            className={cn(
              'flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-60',
              selectedVisibility === 'PRIVATE'
                ? 'border-slate-500/50 bg-slate-500/10 ring-1 ring-slate-500/30 shadow-2xs'
                : 'border-border/80 bg-card hover:bg-muted/50 hover:border-border text-muted-foreground'
            )}
          >
            <div
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
                selectedVisibility === 'PRIVATE'
                  ? 'border-slate-500/40 bg-slate-500/20 text-slate-700 dark:text-slate-300'
                  : 'border-border/80 bg-muted/50 text-muted-foreground'
              )}
            >
              <Lock className="h-4 w-4 shrink-0" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs font-bold text-foreground">Internal System Only</span>
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[9px] font-semibold',
                    selectedVisibility === 'PRIVATE'
                      ? 'border-slate-500/40 text-slate-700 dark:text-slate-300 bg-slate-500/10'
                      : 'opacity-60'
                  )}
                >
                  PRIVATE
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
                Incidents default to private. Kept internal and hidden from status pages until
                explicitly promoted to public.
              </p>
            </div>
          </button>
        </div>

        {canManage && (
          <div className="pt-1 flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground">
              {isDirty
                ? 'Unsaved changes. Click save to apply to future incidents.'
                : 'Applies to all new manual, alert, and integration incidents.'}
            </p>
            <Button
              type="button"
              size="sm"
              disabled={!isDirty || isPending}
              onClick={handleSave}
              className="text-xs"
            >
              {isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              {isPending ? 'Saving...' : 'Save Visibility'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
