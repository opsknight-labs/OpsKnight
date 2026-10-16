'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useActionState,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type ComponentProps,
} from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter, unstable_rethrow } from 'next/navigation';
import { AlertTriangle, Info, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
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

import { notify } from '@/lib/toast';
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

const InvalidFormContext = createContext(false);
// Action forms require client-side dispatch. Do not offer an enabled submit
// button while a newly streamed card is still waiting for hydration.
const subscribeHydration = () => () => undefined;
const clientHydrated = () => true;
const serverHydrated = () => false;

export function SubmitButton({
  children,
  pendingLabel = 'Saving…',
  ...props
}: ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  const invalid = useContext(InvalidFormContext);
  return (
    <Button
      {...props}
      type="submit"
      disabled={pending || invalid || props.disabled}
      aria-busy={pending}
    >
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </Button>
  );
}

export type RunbookFormAction = (data: FormData) => Promise<void | {
  error?: string;
  saved?: boolean;
  draftRevision?: number;
  [key: string]: unknown;
}>;
export function ActionForm({
  action,
  children,
  className,
  onSuccess,
  successMessage = 'Changes saved',
}: {
  action: RunbookFormAction;
  children: ReactNode;
  className?: string;
  successMessage?: string;
  onSuccess?: (result?: {
    saved?: boolean;
    draftRevision?: number;
    [key: string]: unknown;
  }) => void;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [invalid, setInvalid] = useState(false);
  const interactive = useSyncExternalStore(subscribeHydration, clientHydrated, serverHydrated);
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const refresh = () => setInvalid(Boolean(form.querySelector('[data-form-invalid="true"]')));
    const observer = new MutationObserver(refresh);
    observer.observe(form, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-form-invalid'],
      childList: true,
    });
    refresh();
    return () => observer.disconnect();
  }, []);
  const [state, submit, pending] = useActionState<
    { error?: string; saved?: boolean; draftRevision?: number },
    FormData
  >(async (_state, data: FormData) => {
    try {
      const result = await action(data);
      if (result?.error) {
        notify.error(result.error);
        return { error: result.error };
      }
      const successPayload = { saved: true, ...(result || {}) };
      notify.success(successMessage);
      onSuccess?.(successPayload);
      router.refresh();
      return successPayload;
    } catch (error) {
      unstable_rethrow(error);
      const message =
        'Could not complete this action. Check your configuration and permissions, then try again.';
      notify.error(message);
      return { error: message };
    }
  }, {});
  return (
    <form
      ref={formRef}
      action={submit}
      className={className}
      onSubmit={event => {
        if (invalid) event.preventDefault();
      }}
    >
      <InvalidFormContext.Provider value={invalid || !interactive}>
        <fieldset disabled={pending} className="contents">
          {children}
        </fieldset>
        {state.error && (
          <p
            role="alert"
            className="col-span-full flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{state.error}</span>
          </p>
        )}
      </InvalidFormContext.Provider>
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
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="sticky top-0 z-10 space-y-1 border-b bg-background/95 px-6 py-5 pr-16 text-left backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <SheetTitle className="text-base font-semibold tracking-tight">{title}</SheetTitle>
          <SheetDescription className="text-xs leading-relaxed">{description}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-6 px-6 py-6">{children}</div>
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
  successMessage = 'Changes applied',
}: {
  action: RunbookFormAction;
  title: string;
  description: string;
  label: string;
  variant?: ComponentProps<typeof Button>['variant'];
  successMessage?: string;
}) {
  const [open, setOpen] = useState(false);
  const destructive = variant === 'destructive';
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant={variant} size="sm">
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader className="sm:flex-row sm:items-start sm:gap-4 sm:space-y-0">
          <span
            aria-hidden="true"
            className={cn(
              'mx-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1 ring-inset sm:mx-0',
              destructive
                ? 'bg-destructive/10 text-destructive ring-destructive/20'
                : 'bg-primary/10 text-primary ring-primary/20'
            )}
          >
            {destructive ? <AlertTriangle className="h-5 w-5" /> : <Info className="h-5 w-5" />}
          </span>
          <div className="space-y-1.5">
            <AlertDialogTitle className="text-base">{title}</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              {description}
            </AlertDialogDescription>
          </div>
        </AlertDialogHeader>
        <ActionForm
          action={action}
          successMessage={successMessage}
          onSuccess={() => setOpen(false)}
          className="space-y-3"
        >
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel className="mt-0">Keep unchanged</AlertDialogCancel>
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
  className,
}: {
  name: string;
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select
      name={name}
      defaultValue={defaultValue}
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
    >
      <SelectTrigger
        id={name}
        aria-label={label}
        className={cn(
          'h-9 w-full rounded-xl border border-input/80 dark:border-border/70 bg-background/80 hover:bg-accent/40 shadow-2xs text-xs font-medium focus-visible:ring-2 focus-visible:ring-primary/40 focus:ring-2 focus:ring-primary/40 transition-colors',
          className
        )}
      >
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent className="rounded-2xl border border-border/80 dark:border-border/60 bg-popover/95 dark:bg-popover/90 backdrop-blur-md shadow-xl p-1.5">
        {options
          .filter(option => option.value !== '')
          .map(option => (
            <SelectItem
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              className="rounded-xl px-2.5 py-1.5 text-xs font-medium cursor-pointer transition-colors focus:bg-primary/10 focus:text-primary data-[state=checked]:bg-primary/10 data-[state=checked]:text-primary"
            >
              {option.label}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}
