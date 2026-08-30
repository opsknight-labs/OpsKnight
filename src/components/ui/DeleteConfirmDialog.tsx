'use client';

import React, { useState, useTransition, type ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/shadcn/dialog';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type DeleteConfirmDialogProps = {
  title?: string;
  description: ReactNode;
  requireMatchText?: string;
  matchPrompt?: string;
  confirmText?: string;
  cancelText?: string;
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onConfirm: () => Promise<void> | void;
  className?: string;
  disabled?: boolean;
};

export default function DeleteConfirmDialog({
  title = 'Are you absolutely sure?',
  description,
  requireMatchText,
  matchPrompt,
  confirmText = 'Delete',
  cancelText = 'Cancel',
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  onConfirm,
  className,
  disabled = false,
}: DeleteConfirmDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [typedMatchText, setTypedMatchText] = useState('');
  const [isPending, startTransition] = useTransition();

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;
  const setOpen = (val: boolean) => {
    if (isControlled) {
      controlledOnOpenChange?.(val);
    } else {
      setInternalOpen(val);
    }
    if (!val) {
      setTypedMatchText('');
    }
  };

  const isMatchValid = requireMatchText ? typedMatchText.trim() === requireMatchText.trim() : true;

  const handleConfirm = () => {
    if (!isMatchValid || isPending) return;
    startTransition(async () => {
      await onConfirm();
      setOpen(false);
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className={cn('sm:max-w-md space-y-2', className)}>
        <DialogHeader className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/20">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </div>
            <DialogTitle className="text-base font-bold text-foreground">{title}</DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground leading-relaxed pt-1">
            {description}
          </DialogDescription>
        </DialogHeader>

        {requireMatchText && (
          <div className="space-y-2 pt-2">
            <p className="text-xs font-medium text-foreground">
              {matchPrompt || (
                <>
                  Type{' '}
                  <span className="font-bold text-destructive font-mono bg-destructive/10 px-1.5 py-0.5 rounded">
                    {requireMatchText}
                  </span>{' '}
                  to confirm:
                </>
              )}
            </p>
            <Input
              value={typedMatchText}
              onChange={e => setTypedMatchText(e.target.value)}
              placeholder={requireMatchText}
              className="font-mono text-xs"
              autoFocus
              disabled={isPending || disabled}
            />
          </div>
        )}

        <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2 pt-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={isPending}
            className="text-xs"
          >
            {cancelText}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={handleConfirm}
            disabled={!isMatchValid || isPending || disabled}
            className="text-xs gap-1.5"
          >
            {isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Deleting...</span>
              </>
            ) : (
              <>
                <Trash2 className="h-3.5 w-3.5" />
                <span>{confirmText}</span>
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
