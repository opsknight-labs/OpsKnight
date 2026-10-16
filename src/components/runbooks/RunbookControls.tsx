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
          <Loader2 className="h-4 w-4 animate-spin" />
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
            className="col-span-full rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
          >
            {state.error}
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
        <ActionForm
          action={action}
          successMessage={successMessage}
          onSuccess={() => setOpen(false)}
          className="space-y-3"
        >
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
      <SelectTrigger id={name} aria-label={label}>
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
