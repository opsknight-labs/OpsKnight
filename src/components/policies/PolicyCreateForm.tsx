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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { Plus, X, Loader2, AlertCircle, ShieldAlert } from 'lucide-react';
import type { PolicyFormState } from '@/app/(app)/policies/actions';

type PolicyCreateFormProps = {
  action: (prevState: PolicyFormState, formData: FormData) => Promise<PolicyFormState>;
  canCreate?: boolean;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="gap-2 font-medium shadow-xs">
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Creating policy...
        </>
      ) : (
        <>
          <Plus className="h-4 w-4" />
          Create Policy
        </>
      )}
    </Button>
  );
}

export default function PolicyCreateForm({ action, canCreate = true }: PolicyCreateFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const router = useRouter();
  const { showToast } = useToast();

  const handleAction = async (prevState: PolicyFormState, formData: FormData) => {
    const res = await action(prevState, formData);
    if (res?.success) {
      showToast('Escalation policy created successfully', 'success');
      formRef.current?.reset();
      setIsOpen(false);
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

  if (!canCreate) {
    return (
      <Alert className="bg-muted/50">
        <ShieldAlert className="h-4 w-4" />
        <AlertDescription className="text-xs">
          You do not have permission to create escalation policies. Admin role is required.
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
          <h3 className="font-semibold text-base text-foreground">Create New Escalation Policy</h3>
          <p className="text-muted-foreground text-xs mt-0.5">
            Define multi-tier responder routing, escalation delays, and notification rules
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
            <CardTitle className="text-base">Create New Escalation Policy</CardTitle>
            <CardDescription className="text-xs">
              Configure initial policy details. Escalation steps and responder targets can be
              configured after creation.
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
          <div className="space-y-1.5">
            <Label htmlFor="name" className="text-xs font-medium text-foreground">
              Policy Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              name="name"
              placeholder="e.g. Tier 1 Critical Production Response"
              required
              maxLength={100}
              className="text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description" className="text-xs font-medium text-foreground">
              Description <span className="text-muted-foreground text-[10px]">(optional)</span>
            </Label>
            <Textarea
              id="description"
              name="description"
              placeholder="Describe when this policy should be used and which services it covers..."
              maxLength={500}
              className="resize-none text-xs"
              rows={2}
            />
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
