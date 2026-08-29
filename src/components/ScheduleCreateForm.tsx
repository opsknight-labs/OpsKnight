'use client';

import { useActionState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-product-notification';
import TimeZoneSelect from './TimeZoneSelect';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import { Plus, Loader2, CalendarPlus, ShieldAlert } from 'lucide-react';
import { useFormStatus } from 'react-dom';

type ScheduleCreateFormProps = {
  action: (
    prevState: any,
    formData: FormData
  ) => Promise<{ error?: string } | { success?: boolean }>;
  canCreate: boolean;
};

type FormState = {
  error?: string | null;
  success?: boolean;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full gap-2 font-medium shadow-xs">
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Creating schedule...
        </>
      ) : (
        <>
          <Plus className="h-4 w-4" />
          Create Schedule
        </>
      )}
    </Button>
  );
}

export default function ScheduleCreateForm({ action, canCreate }: ScheduleCreateFormProps) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {
    error: null,
    success: false,
  });
  const formRef = useRef<HTMLFormElement | null>(null);
  const router = useRouter();
  const { showToast } = useToast();

  useEffect(() => {
    if (state.success) {
      showToast('Schedule created successfully', 'success');
      formRef.current?.reset();
      router.refresh();
    } else if (state.error) {
      showToast(state.error, 'error');
    }
  }, [state, router, showToast]);

  if (!canCreate) {
    return (
      <Card id="new-schedule" className="border-border/70 shadow-xs opacity-75">
        <CardHeader className="border-b bg-muted/20 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 ring-1 ring-inset ring-amber-500/20 dark:text-amber-400">
              <ShieldAlert className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">New Schedule</CardTitle>
              <CardDescription className="text-[11px]">Permission restricted</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 text-xs text-muted-foreground">
          Admin or Responder role is required to create and manage on-call schedules.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card id="new-schedule" className="overflow-hidden border-border/70 shadow-xs">
      <CardHeader className="border-b bg-muted/20 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
            <CalendarPlus className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-sm font-semibold">Create Schedule</CardTitle>
            <CardDescription className="text-[11px]">
              Define rotation name and base timezone
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-3.5">
        <form ref={formRef} action={formAction} className="space-y-3.5">
          <div className="space-y-1.5">
            <Label htmlFor="name" className="text-xs font-medium text-foreground">
              Schedule Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              name="name"
              placeholder="e.g. Primary on-call"
              required
              maxLength={200}
              className="text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="timeZone" className="text-xs font-medium text-foreground">
              Time Zone <span className="text-destructive">*</span>
            </Label>
            <TimeZoneSelect name="timeZone" defaultValue="UTC" />
            <p className="text-[10px] text-muted-foreground">
              Shifts, rotations, and handoffs will follow this timezone.
            </p>
          </div>

          <SubmitButton />

          {state?.error && (
            <Alert variant="destructive" className="py-2 text-xs">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
