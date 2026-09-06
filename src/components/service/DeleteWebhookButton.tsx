'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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
import { Trash2, Loader2 } from 'lucide-react';
import { logger } from '@/lib/logger';
import { useToast } from '@/hooks/use-product-notification';

type Props = {
  deleteAction: () => Promise<void>;
  redirectTo?: string;
};

export default function DeleteWebhookButton({ deleteAction, redirectTo }: Props) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { showToast } = useToast();

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteAction();
      showToast('Webhook deleted successfully', 'success');
      if (redirectTo) {
        router.push(redirectTo);
        router.refresh();
      } else {
        setOpen(false);
        setIsDeleting(false);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to delete webhook', { error: errorMessage });
      showToast('Failed to delete webhook', 'error');
      setIsDeleting(false);
      setOpen(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" type="button" disabled={isDeleting}>
          {isDeleting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="mr-2 h-4 w-4" />
          )}
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently delete the webhook integration and
            stop any notifications sent to it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={e => {
              e.preventDefault();
              handleDelete();
            }}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Yes, Delete Webhook
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
