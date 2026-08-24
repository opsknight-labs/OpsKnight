'use client';

import { useActionState } from 'react';
import { useRef, useEffect } from 'react';
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
import { AlertCircle, Plus, Loader2 } from 'lucide-react';
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
    <Button type="submit" disabled={pending} className="w-full gap-2">
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Creating...
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
      <Card id="new-schedule" className="opacity-60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-orange-600" />
            New Schedule
          </CardTitle>
          <CardDescription>Admin or Responder role required</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pointer-events-none">
          <div className="space-y-2">
            <Label htmlFor="name-disabled" className="text-sm">
              Name
            </Label>
            <Input
              id="name-disabled"
              name="name"
              placeholder="Primary on-call"
              disabled
              className="bg-muted"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="timezone-disabled" className="text-sm">
              Time Zone
            </Label>
            <TimeZoneSelect name="timeZone" defaultValue="UTC" disabled />
          </div>
          <Button disabled className="w-full">
            Create Schedule
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card id="new-schedule" className="shadow-sm border-slate-200">
      <CardHeader className="pb-3 border-b border-slate-100 bg-slate-50/50">
        <CardTitle className="text-base flex items-center gap-2">
          <Plus className="h-4 w-4 text-primary" />
          New Schedule
        </CardTitle>
        <CardDescription>Create a rotation schedule for on-call coverage</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <form ref={formRef} action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-sm">
              Name <span className="text-red-500">*</span>
            </Label>
            <Input id="name" name="name" placeholder="Primary on-call" required maxLength={200} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="timeZone" className="text-sm">
              Time Zone <span className="text-red-500">*</span>
            </Label>
            <TimeZoneSelect name="timeZone" defaultValue="UTC" />
          </div>

          <SubmitButton />

          {state?.error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">{state.error}</AlertDescription>
            </Alert>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
