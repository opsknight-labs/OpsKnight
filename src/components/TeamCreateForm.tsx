'use client';

import { useState, useRef, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { getUserFacingErrorMessage } from '@/lib/user-facing-error';
import { useToast } from '@/hooks/use-product-notification';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/shadcn/dialog';
import { Plus, AlertCircle } from 'lucide-react';

type FormState = {
  error?: string | null;
  success?: boolean;
};

type TeamCreateFormProps = {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  canCreate?: boolean;
  /** Trigger label; the page header uses the default. */
  label?: string;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      <Plus aria-hidden="true" />
      Create team
    </Button>
  );
}

/** "New team" button that opens the create dialog. Rendered as the page header's primary action. */
export default function TeamCreateForm({
  action,
  canCreate = true,
  label = 'New team',
}: TeamCreateFormProps) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const router = useRouter();
  const { showToast } = useToast();

  const handleAction = async (prevState: FormState, formData: FormData) => {
    const res = await action(prevState, formData);
    if (res?.success) {
      showToast('Team created', 'success');
      formRef.current?.reset();
      setOpen(false);
      router.refresh();
    } else if (res?.error) {
      showToast(getUserFacingErrorMessage(res.error), 'error');
    }
    return res;
  };

  const [state, formAction] = useActionState(handleAction, { error: null, success: false });

  if (!canCreate) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden="true" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New team</DialogTitle>
          <DialogDescription>
            Name the team now. You add members, a team lead and owned services after it is created.
          </DialogDescription>
        </DialogHeader>

        <form ref={formRef} action={formAction} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="team-name">
              Team name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="team-name"
              name="name"
              required
              placeholder="e.g. Core Infrastructure"
              maxLength={200}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="team-description">
              Mission <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="team-description"
              name="description"
              placeholder="What does this team own and support?"
              maxLength={1000}
            />
          </div>

          {state?.error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>{getUserFacingErrorMessage(state.error)}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
