'use client';

import { useEffect, useRef, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { getUserFacingErrorMessage } from '@/lib/user-facing-error';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import { Plus, Loader2, AlertCircle } from 'lucide-react';

type FormState = {
  error?: string | null;
  success?: boolean;
};

type Props = {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="gap-2">
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

export default function TeamCreateForm({ action }: Props) {
  const [state, formAction] = useActionState(action, { error: null, success: false });
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (state?.success) {
      formRef.current?.reset();
    }
  }, [state?.success]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name" className="text-sm font-medium">
            Team Name <span className="text-red-500">*</span>
          </Label>
          <Input
            id="name"
            name="name"
            required
            placeholder="e.g. Platform Operations"
            maxLength={200}
            className="w-full"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description" className="text-sm font-medium">
            Description
          </Label>
          <Input
            id="description"
            name="description"
            placeholder="What does this team own?"
            maxLength={1000}
            className="w-full"
          />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <SubmitButton />
        {state?.error && (
          <Alert variant="destructive" className="flex-1 py-2">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-sm">
              {getUserFacingErrorMessage(state.error)}
            </AlertDescription>
          </Alert>
        )}
      </div>
    </form>
  );
}
