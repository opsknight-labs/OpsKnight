'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { notify } from '@/lib/toast';
import { Button } from '@/components/ui/shadcn/button';
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
import { cn } from '@/lib/utils';

/**
 * A destructive row action (for example "Revoke grant") that asks for confirmation first, then
 * submits the given fields to an existing server action. The server action keeps all checks.
 */
export default function McpConfirmAction({
  action,
  fields,
  label,
  accessibleLabel,
  title,
  description,
  confirmLabel,
  successMessage,
  icon,
  className,
}: {
  action: (form: FormData) => Promise<void>;
  fields: Record<string, string>;
  /** Visible trigger text. */
  label: string;
  /** Accessible name when the visible text needs context, e.g. "Revoke Claude for Jane". */
  accessibleLabel?: string;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  successMessage: string;
  icon?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function confirm() {
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) form.set(name, value);
    startTransition(async () => {
      try {
        await action(form);
        setOpen(false);
        notify.success(successMessage, { id: `settings:mcp:${label}` });
        router.refresh();
      } catch (error) {
        notify.error(error, { id: `settings:mcp:${label}` });
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={next => !pending && setOpen(next)}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={accessibleLabel}
          className={cn(
            'h-8 gap-1.5 border-destructive/30 px-2.5 text-xs text-destructive hover:border-destructive/50 hover:bg-destructive/5 hover:text-destructive',
            className
          )}
        >
          {icon}
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-lg">{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
              {description}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button type="button" variant="destructive" disabled={pending} onClick={confirm}>
            {pending ? 'Working…' : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
