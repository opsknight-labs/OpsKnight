'use client';

import { useState, useRef, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { getUserFacingErrorMessage } from '@/lib/user-facing-error';
import { notify } from '@/lib/toast';
import { Button } from '@/components/ui/shadcn/button';
import { CreateTrigger } from '@/components/patterns';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { Plus, X, Loader2, AlertCircle, ShieldAlert } from 'lucide-react';

type FormState = {
  error?: string | null;
  success?: boolean;
};

type TeamCreateFormProps = {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  canCreate?: boolean;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="gap-2 font-medium shadow-xs">
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Creating...
        </>
      ) : (
        <>
          <Plus className="h-4 w-4" />
          Create Team
        </>
      )}
    </Button>
  );
}

export default function TeamCreateForm({ action, canCreate = true }: TeamCreateFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const router = useRouter();

  const handleAction = async (prevState: FormState, formData: FormData) => {
    const res = await action(prevState, formData);
    if (res?.success) {
      notify.success('Team created successfully');
      formRef.current?.reset();
      setIsOpen(false);
      router.refresh();
    } else if (res?.error) {
      notify.error(getUserFacingErrorMessage(res.error));
    }
    return res;
  };

  const [state, formAction] = useActionState(handleAction, { error: null, success: false });

  if (!canCreate) {
    return (
      <Alert className="bg-muted/50">
        <ShieldAlert className="h-4 w-4" />
        <AlertDescription className="text-xs">
          You do not have access to create teams. Admin or Responder role is required.
        </AlertDescription>
      </Alert>
    );
  }

  if (!isOpen) {
    return (
      <CreateTrigger
        title="Create New Team"
        description="Add a new team to manage ownership, responders, and service coverage"
        onClick={() => setIsOpen(true)}
      />
    );
  }

  return (
    <Card className="border-primary/20 shadow-lg relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary/40 to-primary" />
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">Create New Team</CardTitle>
            <CardDescription className="text-xs">
              Configure basic details for your new team. Members and services can be attached after
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
                Team Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                name="name"
                required
                placeholder="e.g. Core Infrastructure"
                maxLength={200}
                className="text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description" className="text-xs font-medium text-foreground">
                Mission / Description
              </Label>
              <Input
                id="description"
                name="description"
                placeholder="What does this team own and support?"
                maxLength={1000}
                className="text-xs"
              />
            </div>
          </div>

          {state?.error && (
            <Alert variant="destructive" className="py-2 text-xs">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{getUserFacingErrorMessage(state.error)}</AlertDescription>
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
