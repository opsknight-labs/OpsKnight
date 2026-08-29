'use client';

import { useEffect, useRef, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { getUserFacingErrorMessage } from '@/lib/user-facing-error';
import { useToast } from '@/hooks/use-product-notification';
import { Button } from '@/components/ui/shadcn/button';
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
import { Plus, Loader2, AlertCircle, ShieldAlert, Users } from 'lucide-react';

type FormState = {
  error?: string | null;
  success?: boolean;
};

type Props = {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  canCreate?: boolean;
  isCardWrapper?: boolean;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full gap-2 font-medium shadow-xs">
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Creating team...
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

export default function TeamCreateForm({ action, canCreate = true, isCardWrapper = true }: Props) {
  const [state, formAction] = useActionState(action, { error: null, success: false });
  const formRef = useRef<HTMLFormElement | null>(null);
  const router = useRouter();
  const { showToast } = useToast();

  useEffect(() => {
    if (state?.success) {
      showToast('Team created successfully', 'success');
      formRef.current?.reset();
      router.refresh();
    } else if (state?.error) {
      showToast(getUserFacingErrorMessage(state.error), 'error');
    }
  }, [state, router, showToast]);

  if (!canCreate) {
    return (
      <Card id="create-team" className="border-border/70 shadow-xs opacity-75">
        <CardHeader className="border-b bg-muted/20 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 ring-1 ring-inset ring-amber-500/20 dark:text-amber-400">
              <ShieldAlert className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">Create Team</CardTitle>
              <CardDescription className="text-[11px]">Permission restricted</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 text-xs text-muted-foreground">
          Admin or Responder role is required to create new teams.
        </CardContent>
      </Card>
    );
  }

  const formBody = (
    <form ref={formRef} action={formAction} className="space-y-3.5">
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
          placeholder="What does this team own?"
          maxLength={1000}
          className="text-xs"
        />
      </div>

      <SubmitButton />

      {state?.error && (
        <Alert variant="destructive" className="py-2 text-xs">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{getUserFacingErrorMessage(state.error)}</AlertDescription>
        </Alert>
      )}
    </form>
  );

  if (!isCardWrapper) {
    return formBody;
  }

  return (
    <Card id="create-team" className="overflow-hidden border-border/70 shadow-xs">
      <CardHeader className="border-b bg-muted/20 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
            <Users className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-sm font-semibold">Create Team</CardTitle>
            <CardDescription className="text-[11px]">
              Organize responders and service ownership
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-3.5">{formBody}</CardContent>
    </Card>
  );
}
