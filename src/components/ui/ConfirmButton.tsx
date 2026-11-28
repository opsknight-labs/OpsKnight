'use client';

import type { ComponentProps, ReactNode } from 'react';
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
import { Button } from '@/components/ui/shadcn/button';

/**
 * A button that asks before it acts, in plain words, for anything that changes who is paged, stops something
 * working or cannot be undone. Only the dialog's confirm button runs `onConfirm`. For a destructive delete that
 * needs typing a name, use DeleteConfirmDialog instead.
 */
export default function ConfirmButton({
  children,
  title,
  description,
  confirmLabel,
  onConfirm,
  ...buttonProps
}: {
  children: ReactNode;
  title: string;
  description: ReactNode;
  /** Label of the button that does it; defaults to the trigger's text. */
  confirmLabel?: string;
  onConfirm: () => void;
} & Omit<ComponentProps<typeof Button>, 'onClick' | 'type'>) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" {...buttonProps}>
          {children}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11 sm:h-10">Cancel</AlertDialogCancel>
          <AlertDialogAction className="h-11 sm:h-10" onClick={onConfirm}>
            {confirmLabel ?? (typeof children === 'string' ? children : 'Confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
