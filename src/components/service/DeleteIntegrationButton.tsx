'use client';

import { useState } from 'react';
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
import { Trash2 } from 'lucide-react';

type DeleteIntegrationButtonProps = {
  action: (formData: FormData) => void;
  integrationName: string;
  variant?: 'default' | 'icon';
};

export default function DeleteIntegrationButton({
  action,
  integrationName,
  variant = 'default',
}: DeleteIntegrationButtonProps) {
  const [open, setOpen] = useState(false);

  const handleConfirm = () => {
    const formData = new FormData();
    action(formData);
    setOpen(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        {variant === 'icon' ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-slate-400 hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Integration</AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            <div>
              Are you sure you want to delete the integration{' '}
              <span className="font-semibold text-foreground">"{integrationName}"</span>?
            </div>
            <div className="bg-amber-50 border-l-4 border-amber-500 p-3 text-amber-800 text-xs rounded-r">
              <span className="font-bold block mb-1">⚠️ Manual Action Required</span>
              Deleting this integration <strong>only removes it from OpsKnight</strong>. You must
              manually delete the webhook from your external provider (e.g. GitHub, Datadog) to stop
              them from sending events.
            </div>
            <div className="text-xs text-muted-foreground">This action cannot be undone.</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={e => {
              e.preventDefault();
              handleConfirm();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Yes, Delete Integration
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
