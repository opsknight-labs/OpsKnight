'use client';

import { useState, useRef, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-product-notification';
import TimeZoneSelect from './TimeZoneSelect';
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
import { Label } from '@/components/ui/shadcn/label';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import { Plus, AlertCircle } from 'lucide-react';
import type { ScheduleActionState } from '@/lib/schedule-action-errors';

type ScheduleCreateFormProps = {
  action: (prevState: ScheduleActionState, formData: FormData) => Promise<ScheduleActionState>;
  canCreate: boolean;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      {!pending && <Plus aria-hidden="true" />}
      {pending ? 'Creating schedule…' : 'Create schedule'}
    </Button>
  );
}

export default function ScheduleCreateForm({ action, canCreate }: ScheduleCreateFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const router = useRouter();
  const { showToast } = useToast();

  const handleAction = async (prevState: ScheduleActionState, formData: FormData) => {
    const res = await action(prevState, formData);
    if (res?.success) {
      showToast('Schedule created successfully', 'success');
      formRef.current?.reset();
      setIsOpen(false);
      router.refresh();
    } else if (res?.error) {
      showToast(res.error, 'error');
    }
    return res;
  };

  const [state, formAction] = useActionState<ScheduleActionState, FormData>(handleAction, {
    error: undefined,
    success: false,
  });

  if (!canCreate) return null;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4" aria-hidden="true" />
          New schedule
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New schedule</DialogTitle>
          <DialogDescription>
            Name the rotation and pick its base time zone. Add layers and responders on the schedule
            page after it is created.
          </DialogDescription>
        </DialogHeader>

        <form ref={formRef} action={formAction} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="schedule-name">
              Schedule name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="schedule-name"
              name="name"
              placeholder="e.g. Primary SRE rotation"
              required
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5" role="group" aria-labelledby="schedule-timezone-label">
            <Label id="schedule-timezone-label">
              Base time zone <span className="text-destructive">*</span>
            </Label>
            <TimeZoneSelect name="timeZone" defaultValue="UTC" />
          </div>

          {state?.error && (
            <Alert variant="destructive" className="py-2 text-xs">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter className="gap-2 border-t border-border pt-4 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <SubmitButton />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
