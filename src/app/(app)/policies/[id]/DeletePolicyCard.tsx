'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useToast } from '@/hooks/use-product-notification';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/shadcn/alert-dialog';
import { Trash2, AlertTriangle, Loader2, ShieldAlert, ArrowUpRight, Server } from 'lucide-react';

export type DeletePolicyCardProps = {
  policyId: string;
  policyName: string;
  servicesUsingPolicy: Array<{ id: string; name: string }>;
  deletePolicyAction: (
    policyId: string
  ) => Promise<{ success?: boolean; error?: string } | undefined>;
};

export default function DeletePolicyCard({
  policyId,
  policyName,
  servicesUsingPolicy,
  deletePolicyAction,
}: DeletePolicyCardProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const hasDependencies = servicesUsingPolicy.length > 0;

  const handleDelete = () => {
    startTransition(async () => {
      try {
        const res = await deletePolicyAction(policyId);
        if (res?.error) {
          showToast(res.error, 'error');
        } else {
          showToast(`Escalation policy "${policyName}" deleted successfully`, 'success');
          router.push('/policies');
          router.refresh();
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Failed to delete escalation policy';
        showToast(msg, 'error');
      } finally {
        setOpen(false);
      }
    });
  };

  return (
    <Card className="overflow-hidden border-destructive/30 bg-destructive/5 shadow-xs">
      <CardHeader className="border-b border-destructive/20 bg-destructive/10 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-4 w-4" />
          <CardTitle className="text-sm font-semibold text-destructive">Danger Zone</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-4 sm:p-5">
        {hasDependencies ? (
          <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-900 dark:text-amber-200">
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-sm text-foreground">
                  Policy In Use — Deletion Blocked
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  This policy cannot be deleted because it is currently assigned to{' '}
                  <strong>
                    {servicesUsingPolicy.length} service
                    {servicesUsingPolicy.length === 1 ? '' : 's'}
                  </strong>
                  . Please reassign or remove the policy from those services before deleting.
                </p>
              </div>
            </div>

            <div className="space-y-2 pt-1 border-t border-amber-500/20">
              <p className="text-[11px] font-medium text-foreground">Dependent Services:</p>
              <div className="flex flex-wrap gap-2">
                {servicesUsingPolicy.map(service => (
                  <Link
                    key={service.id}
                    href={`/services/${service.id}`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border/60 bg-background/80 hover:border-primary/40 text-xs font-medium text-foreground hover:text-primary transition-colors"
                  >
                    <Server className="h-3 w-3 text-muted-foreground" />
                    <span>{service.name}</span>
                    <ArrowUpRight className="h-3 w-3 opacity-60" />
                  </Link>
                ))}
              </div>
            </div>

            <div className="pt-1 flex items-center justify-between">
              <p className="text-[11px] text-muted-foreground">
                Reassign all services above to enable deletion.
              </p>
              <Button
                variant="destructive"
                size="sm"
                disabled
                className="gap-1.5 text-xs font-medium opacity-50 cursor-not-allowed"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Policy
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-foreground">Delete this escalation policy</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 max-w-md">
                Permanently delete <strong>{policyName}</strong> and all of its configured
                notification steps. This action cannot be undone.
              </p>
            </div>

            <AlertDialog open={open} onOpenChange={setOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-1.5 text-xs font-medium shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete Policy
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="text-xs sm:text-sm">
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                    <Trash2 className="h-4 w-4" />
                    Delete Policy Permanently
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete <strong>{policyName}</strong>? All configured
                    escalation steps will be permanently removed. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    disabled={isPending}
                    className="bg-destructive hover:bg-destructive/90"
                  >
                    {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Delete Policy'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
