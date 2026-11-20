'use client';

import { AlertTriangle, Info } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/shadcn/alert-dialog';
import { buttonVariants } from '@/components/ui/shadcn/button';
import { cn } from '@/lib/utils';

type ConfirmDialogProps = {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  variant?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
};

// Theme tokens only, so the dialog reads correctly in light and dark.
const VARIANTS = {
  danger: {
    Icon: AlertTriangle,
    icon: 'bg-destructive/10 text-destructive',
    action: buttonVariants({ variant: 'destructive' }),
  },
  warning: {
    Icon: AlertTriangle,
    icon: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    action: 'bg-amber-700 text-white hover:bg-amber-800',
  },
  info: {
    Icon: Info,
    icon: 'bg-primary/10 text-primary',
    action: buttonVariants(),
  },
} as const;

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText,
  cancelText,
  variant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { Icon, icon, action } =
    variant === 'warning' ? VARIANTS.warning : variant === 'info' ? VARIANTS.info : VARIANTS.danger;

  return (
    <AlertDialog open={isOpen} onOpenChange={open => !open && onCancel()}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader className="sm:flex-row sm:items-start sm:gap-4 sm:space-y-0">
          <span
            className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', icon)}
            aria-hidden="true"
          >
            <Icon className="h-5 w-5" />
          </span>
          <div className="space-y-2">
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line">
              {message}
            </AlertDialogDescription>
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelText}</AlertDialogCancel>
          <AlertDialogAction
            className={action}
            onClick={event => {
              // The caller owns closing, as before: keep the dialog open until it does.
              event.preventDefault();
              onConfirm();
            }}
          >
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
