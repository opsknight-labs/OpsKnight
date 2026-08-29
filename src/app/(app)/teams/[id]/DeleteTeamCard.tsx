'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-product-notification';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
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
import { Trash2, AlertTriangle, Loader2 } from 'lucide-react';

type DeleteTeamCardProps = {
  teamId: string;
  teamName: string;
  deleteTeamAction: (teamId: string) => Promise<{ error?: string } | undefined>;
};

export default function DeleteTeamCard({
  teamId,
  teamName,
  deleteTeamAction,
}: DeleteTeamCardProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    startTransition(async () => {
      try {
        const res = await deleteTeamAction(teamId);
        if (res?.error) {
          showToast(res.error, 'error');
        } else {
          showToast(`Team "${teamName}" deleted successfully`, 'success');
          router.push('/teams');
          router.refresh();
        }
      } catch {
        showToast('Failed to delete team', 'error');
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
      <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-foreground">Delete this team</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 max-w-md">
            Permanently delete <strong>{teamName}</strong>. Members will be unassigned and owned
            services will lose team association.
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
              Delete Team
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="text-xs sm:text-sm">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                <Trash2 className="h-4 w-4" />
                Delete Team Permanently
              </AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete <strong>{teamName}</strong>? This action cannot be
                undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                disabled={isPending}
                className="bg-destructive hover:bg-destructive/90"
              >
                {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Delete Team'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
