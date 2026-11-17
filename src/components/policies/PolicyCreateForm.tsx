'use client';

import { useState, useRef, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-product-notification';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';
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
import type { PolicyFormState } from '@/app/(app)/policies/actions';

type PolicyCreateFormProps = {
  action: (prevState: PolicyFormState, formData: FormData) => Promise<PolicyFormState>;
  canCreate?: boolean;
  /** Trigger label; the page header uses the default. */
  label?: string;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      <Plus aria-hidden="true" />
      Create policy
    </Button>
  );
}

/** "New policy" button that opens the create dialog. Rendered as the page header's primary action. */
export default function PolicyCreateForm({
  action,
  canCreate = true,
  label = 'New policy',
}: PolicyCreateFormProps) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const router = useRouter();
  const { showToast } = useToast();

  const handleAction = async (prevState: PolicyFormState, formData: FormData) => {
    const res = await action(prevState, formData);
    if (res?.success) {
      showToast('Escalation policy created', 'success');
      formRef.current?.reset();
      setOpen(false);
      if (res.policyId) {
        router.push(`/policies/${res.policyId}`);
      } else {
        router.refresh();
      }
    } else if (res?.error) {
      showToast(res.error, 'error');
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
          <DialogTitle>New escalation policy</DialogTitle>
          <DialogDescription>
            Name the policy now. You add escalation steps and attach services after it is created.
          </DialogDescription>
        </DialogHeader>

        <form ref={formRef} action={formAction} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="policy-name">
              Policy name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="policy-name"
              name="name"
              placeholder="e.g. Tier 1 production response"
              required
              maxLength={100}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="policy-description">
              Description <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="policy-description"
              name="description"
              placeholder="When should this policy be used, and which services does it cover?"
              maxLength={500}
              className="resize-none"
              rows={3}
            />
          </div>

          {state?.error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>{state.error}</AlertDescription>
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
