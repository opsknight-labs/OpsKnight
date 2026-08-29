'use client';

import { useState, useRef, useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
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
import { Plus, X, Loader2, ShieldAlert, AlertCircle } from 'lucide-react';
import type { ScheduleActionState } from '@/lib/schedule-action-errors';

type ScheduleCreateFormProps = {
  action: any;
  canCreate: boolean;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="gap-2 font-medium shadow-xs">
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
  const [isOpen, setIsOpen] = useState(false);
  const [state, formAction] = useActionState<ScheduleActionState, FormData>(action, {
    error: undefined,
    success: false,
  });
  const formRef = useRef<HTMLFormElement | null>(null);
  const router = useRouter();
  const { showToast } = useToast();

  useEffect(() => {
    if (state?.success) {
      showToast('Schedule created successfully', 'success');
      formRef.current?.reset();
      setIsOpen(false);
      router.refresh();
    } else if (state?.error) {
      showToast(state.error, 'error');
    }
  }, [state, router, showToast]);

  if (!canCreate) {
    return (
      <Alert className="bg-muted/50">
        <ShieldAlert className="h-4 w-4" />
        <AlertDescription className="text-xs">
          You do not have access to create schedules. Admin or Responder role is required.
        </AlertDescription>
      </Alert>
    );
  }

  if (!isOpen) {
    return (
      <Button
        variant="outline"
        className="w-full h-auto py-8 border-dashed border-2 hover:border-primary hover:bg-primary/5 flex flex-col items-center justify-center gap-2 group transition-all rounded-lg"
        onClick={() => setIsOpen(true)}
      >
        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
          <Plus className="h-6 w-6" />
        </div>
        <div className="text-center">
          <h3 className="font-semibold text-base text-foreground">Create New Schedule</h3>
          <p className="text-muted-foreground text-xs mt-0.5">
            Define rotation name, base timezone, and on-call coverage
          </p>
        </div>
      </Button>
    );
  }

  return (
    <Card className="border-primary/20 shadow-lg relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary/40 to-primary" />
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">Create New Schedule</CardTitle>
            <CardDescription className="text-xs">
              Define rotation name and base timezone. Layers and participants can be added after
              creation.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsOpen(false)}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      <form ref={formRef} action={formAction}>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="name" className="text-xs font-medium text-foreground">
                Schedule Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                name="name"
                placeholder="e.g. Primary SRE Rotation"
                required
                maxLength={200}
                className="text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="timeZone" className="text-xs font-medium text-foreground">
                Base Time Zone <span className="text-destructive">*</span>
              </Label>
              <TimeZoneSelect name="timeZone" defaultValue="UTC" />
            </div>
          </div>

          {state?.error && (
            <Alert variant="destructive" className="py-2 text-xs">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsOpen(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <SubmitButton />
          </div>
        </CardContent>
      </form>
    </Card>
  );
}
