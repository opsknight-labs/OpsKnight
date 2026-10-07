'use client';

import { useActionState, useState, type ReactNode, type ComponentProps } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter, unstable_rethrow } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from '@/components/ui/shadcn/sheet';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogTrigger,
} from '@/components/ui/shadcn/alert-dialog';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/shadcn/select';

import { RunbookModuleNav } from './RunbookModuleNav';
import { RunbookStatusBadge } from './RunbookStatusBadge';

export function RunbookNavigation(props: {
  summary?: import('@/lib/runbooks/presentation/contracts').NavigationSummary;
  className?: string;
}) {
  return <RunbookModuleNav summary={props.summary} className={props.className} />;
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return <RunbookStatusBadge status={status} className={className} />;
}

export function SubmitButton({
  children,
  pendingLabel = 'Saving…',
  ...props
}: ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button {...props} type="submit" disabled={pending || props.disabled} aria-busy={pending}>
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </Button>
  );
}

export type RunbookFormAction = (data: FormData) => Promise<void | { error?: string }>;
export function ActionForm({
  action,
  children,
  className,
  onSuccess,
}: {
  action: RunbookFormAction;
  children: ReactNode;
  className?: string;
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const [state, submit, pending] = useActionState<{ error?: string; saved?: boolean }, FormData>(
    async (_state: { error?: string; saved?: boolean }, data: FormData) => {
      try {
        const result = await action(data);
        if (result?.error) return { error: result.error };
        onSuccess?.();
        router.refresh();
        return { saved: true };
      } catch (error) {
        unstable_rethrow(error);
        return {
          error:
            'Could not complete this action. Check your configuration and permissions, then try again.',
        };
      }
    },
    {}
  );
  return (
    <form action={submit} className={className}>
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      {state.error && (
        <p
          role="alert"
          className="col-span-full rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
        >
          {state.error}
        </p>
      )}
      {state.saved && (
        <p role="status" className="col-span-full text-sm text-muted-foreground">
          Changes saved.
        </p>
      )}
    </form>
  );
}

export function ConfigureSheet({
  title,
  description,
  trigger,
  children,
}: {
  title: string;
  description: string;
  trigger: ReactNode;
  children: ReactNode;
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-6">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

export function ConfirmAction({
  action,
  title,
  description,
  label,
  variant = 'destructive',
}: {
  action: RunbookFormAction;
  title: string;
  description: string;
  label: string;
  variant?: ComponentProps<typeof Button>['variant'];
}) {
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant={variant} size="sm">
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <ActionForm action={action} onSuccess={() => setOpen(false)} className="space-y-3">
          <div className="flex flex-wrap justify-end gap-2">
            <AlertDialogCancel>Keep unchanged</AlertDialogCancel>
            <SubmitButton variant={variant} pendingLabel="Applying…">
              {label}
            </SubmitButton>
          </div>
        </ActionForm>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function FormSelect({
  name,
  defaultValue,
  value,
  onValueChange,
  options,
  label,
  disabled,
}: {
  name: string;
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Select
      name={name}
      defaultValue={defaultValue}
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
    >
      <SelectTrigger aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options
          .filter(option => option.value !== '')
          .map(option => (
            <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}
