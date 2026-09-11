'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useToast } from '@/hooks/use-product-notification';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/shadcn/alert-dialog';
import {
  Trash2,
  AlertTriangle,
  Loader2,
  ShieldAlert,
  ArrowUpRight,
  Server,
  Layers,
  Users,
  Clock,
  Shield,
} from 'lucide-react';
import type { LinkedPolicy } from '@/components/schedules/ScheduleLinkedPolicies';
import type { DeleteScheduleResult } from '@/app/(app)/schedules/actions';

type DeleteScheduleCardProps = {
  scheduleId: string;
  scheduleName: string;
  stats: {
    layerCount: number;
    participantCount: number;
    overrideCount: number;
  };
  linkedRules: LinkedPolicy[];
  deleteScheduleAction: (scheduleId: string) => Promise<DeleteScheduleResult>;
};

export default function DeleteScheduleCard({
  scheduleId,
  scheduleName,
  stats,
  linkedRules,
  deleteScheduleAction,
}: DeleteScheduleCardProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Deduplicate linked policies by ID
  const uniquePoliciesMap = new Map<string, LinkedPolicy['policy']>();
  linkedRules.forEach(rule => {
    if (rule.policy && !uniquePoliciesMap.has(rule.policy.id)) {
      uniquePoliciesMap.set(rule.policy.id, rule.policy);
    }
  });
  const policies = Array.from(uniquePoliciesMap.values());
  const hasDependencies = policies.length > 0;
  const isConfirmed = confirmName.trim() === scheduleName.trim();

  const handleDelete = () => {
    if (!isConfirmed || isPending) return;
    setErrorMessage(null);

    startTransition(async () => {
      try {
        const res = await deleteScheduleAction(scheduleId);
        if (!res.success) {
          const msg = res.error || 'Failed to delete schedule.';
          setErrorMessage(msg);
          showToast(msg, 'error');
        } else {
          showToast(`Schedule "${scheduleName}" deleted successfully`, 'success');
          setOpen(false);
          router.push('/schedules');
          router.refresh();
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Failed to delete schedule.';
        setErrorMessage(msg);
        showToast(msg, 'error');
      }
    });
  };

  return (
    <Card className="overflow-hidden border-destructive/30 bg-destructive/5 shadow-xs">
      <CardHeader className="border-b border-destructive/20 bg-destructive/10 px-4 py-3 sm:px-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <CardTitle className="text-sm font-semibold text-destructive">Danger Zone</CardTitle>
          </div>
          <Badge variant="destructive" size="xs" className="text-[10px] font-semibold">
            Admin Only
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-4 sm:p-5 space-y-4">
        {hasDependencies ? (
          <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-900 dark:text-amber-200">
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-sm text-foreground">
                  Schedule In Use — Deletion Blocked
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  This schedule is currently configured as an alert target in{' '}
                  <strong>
                    {policies.length} escalation {policies.length === 1 ? 'policy' : 'policies'}
                  </strong>
                  . To prevent silent notification failures, you must remove or reassign this schedule
                  from all escalation steps before deleting it.
                </p>
              </div>
            </div>

            <div className="space-y-2 pt-1 border-t border-amber-500/20">
              <p className="text-[11px] font-medium text-foreground">
                Dependent Escalation Policies:
              </p>
              <div className="space-y-1.5">
                {policies.map(policy => (
                  <div
                    key={policy.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-background/80 px-2.5 py-1.5"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Shield className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <Link
                        href={`/policies/${policy.id}`}
                        className="font-medium text-foreground hover:text-primary transition-colors flex items-center gap-1 truncate text-xs"
                      >
                        <span>{policy.name}</span>
                        <ArrowUpRight className="h-3 w-3 opacity-60" />
                      </Link>
                    </div>

                    {policy.services.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                          <Server className="h-3 w-3" />
                        </span>
                        {policy.services.map(svc => (
                          <Link
                            key={svc.id}
                            href={`/services/${svc.id}`}
                            className="rounded border bg-muted/30 px-1.5 py-0.5 text-[10px] font-medium hover:border-primary/40 transition-colors"
                          >
                            {svc.name}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-1 flex items-center justify-between">
              <p className="text-[11px] text-muted-foreground">
                Remove all references above to enable deletion.
              </p>
              <Button
                variant="destructive"
                size="sm"
                disabled
                className="gap-1.5 text-xs font-medium opacity-50 cursor-not-allowed"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Schedule
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-foreground">Permanently delete this schedule</p>
              <p className="text-[11px] text-muted-foreground max-w-lg leading-relaxed">
                Permanently deletes <strong>{scheduleName}</strong>, including all rotation layers,
                user assignments, and schedule overrides. This action is irreversible.
              </p>
              <div className="flex items-center gap-2 pt-1">
                <Badge variant="outline" size="xs" className="text-[10px] gap-1">
                  <Layers className="h-3 w-3 text-muted-foreground" />
                  {stats.layerCount} {stats.layerCount === 1 ? 'layer' : 'layers'}
                </Badge>
                <Badge variant="outline" size="xs" className="text-[10px] gap-1">
                  <Users className="h-3 w-3 text-muted-foreground" />
                  {stats.participantCount} {stats.participantCount === 1 ? 'participant' : 'participants'}
                </Badge>
                <Badge variant="outline" size="xs" className="text-[10px] gap-1">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  {stats.overrideCount} {stats.overrideCount === 1 ? 'override' : 'overrides'}
                </Badge>
              </div>
            </div>

            <AlertDialog
              open={open}
              onOpenChange={isOpen => {
                setOpen(isOpen);
                if (!isOpen) {
                  setConfirmName('');
                  setErrorMessage(null);
                }
              }}
            >
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-1.5 text-xs font-medium shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete Schedule
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="text-xs sm:text-sm max-w-md">
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2 text-destructive text-base">
                    <Trash2 className="h-5 w-5" />
                    Delete Schedule Permanently
                  </AlertDialogTitle>
                  <AlertDialogDescription className="space-y-3 pt-2 text-xs leading-relaxed text-muted-foreground">
                    <span>
                      Are you sure you want to delete <strong>{scheduleName}</strong>? This will
                      permanently remove:
                    </span>
                    <ul className="list-disc pl-5 space-y-1 text-foreground font-medium">
                      <li>
                        {stats.layerCount} rotation {stats.layerCount === 1 ? 'layer' : 'layers'}
                      </li>
                      <li>
                        {stats.participantCount} responder {stats.participantCount === 1 ? 'assignment' : 'assignments'}
                      </li>
                      <li>
                        {stats.overrideCount} active and historical {stats.overrideCount === 1 ? 'override' : 'overrides'}
                      </li>
                    </ul>
                    <span className="block text-destructive font-medium pt-1">
                      This action cannot be undone.
                    </span>
                  </AlertDialogDescription>
                </AlertDialogHeader>

                <div className="space-y-2 py-2">
                  <label htmlFor="confirm-schedule-name" className="text-xs text-muted-foreground">
                    To confirm, please type <strong className="text-foreground">{scheduleName}</strong>:
                  </label>
                  <Input
                    id="confirm-schedule-name"
                    value={confirmName}
                    onChange={e => setConfirmName(e.target.value)}
                    placeholder={scheduleName}
                    disabled={isPending}
                    className="text-xs"
                    autoComplete="off"
                  />
                  {errorMessage && (
                    <p className="text-xs text-destructive font-medium">{errorMessage}</p>
                  )}
                </div>

                <AlertDialogFooter className="gap-2 sm:gap-0">
                  <AlertDialogCancel disabled={isPending} className="text-xs">
                    Cancel
                  </AlertDialogCancel>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDelete}
                    disabled={!isConfirmed || isPending}
                    className="text-xs gap-1.5 bg-destructive hover:bg-destructive/90"
                  >
                    {isPending ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      <>
                        <Trash2 className="h-3.5 w-3.5" />
                        Permanently Delete
                      </>
                    )}
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
