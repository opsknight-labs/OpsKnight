'use client';

import { useState, useEffect, useActionState, type CSSProperties } from 'react';
import type { FormEvent } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { Button } from '@/components/ui/shadcn/button';
import { Loader2, Layers, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

type FormState = {
  error?: string | null;
  success?: boolean;
};

type Props = {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  formId: string;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
};

function SubmitButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending || disabled}>
      {pending ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Applying...
        </>
      ) : (
        'Apply'
      )}
    </Button>
  );
}

export default function BulkUserActionsForm({
  action,
  formId,
  className = '',
  style,
  disabled = false,
}: Props) {
  const [state, formAction] = useActionState(action, { error: null, success: false });
  const [localError, setLocalError] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] = useState<string>('');
  const [selectedRole, setSelectedRole] = useState<string>('');
  const router = useRouter();

  useEffect(() => {
    if (state?.success) {
      router.refresh();
      setSelectedAction('');
      setSelectedRole('');
    }
  }, [state?.success, router]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    // We can't easily preventDefault and then submit the form action programmatically
    // with standard server actions if we want to intercept for heavy validation/dialogs
    // without using a client-side wrapper.
    // For now, simple validation.

    // Note: User IDs are collected from the form context (checkboxes must be within this form or associated via form attribute)
    // The parent component UserList usually handles the "checkboxes form association".

    if (!selectedAction) {
      setLocalError('Choose a bulk action first.');
      event.preventDefault();
      return;
    }

    if (selectedAction === 'setRole' && !selectedRole) {
      setLocalError('Select a role.');
      event.preventDefault();
      return;
    }

    if (
      selectedAction === 'delete' &&
      !window.confirm('Delete selected users? This cannot be undone.')
    ) {
      event.preventDefault();
      return;
    }

    setLocalError(null);
  };

  return (
    <form
      id={formId}
      action={formAction}
      onSubmit={handleSubmit}
      className={cn('flex flex-wrap items-center gap-2', className)}
      style={{ ...style, opacity: disabled ? 0.6 : 1 }}
    >
      <fieldset
        disabled={disabled}
        className="flex flex-wrap items-center gap-2 border-none p-0 m-0"
      >
        <input type="hidden" name="bulkAction" value={selectedAction} />
        <Select value={selectedAction} onValueChange={setSelectedAction} disabled={disabled}>
          <SelectTrigger className="w-[180px] h-9">
            <SelectValue placeholder="Bulk Action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="activate">Activate Selected</SelectItem>
            <SelectItem value="deactivate">Deactivate Selected</SelectItem>
            <SelectItem value="setRole">Change Role</SelectItem>
            <SelectItem value="delete" className="text-red-600 focus:text-red-600">
              Delete Selected
            </SelectItem>
          </SelectContent>
        </Select>

        {selectedAction === 'setRole' && (
          <>
            <input type="hidden" name="role" value={selectedRole} />
            <Select
              value={selectedRole}
              onValueChange={setSelectedRole}
              disabled={disabled}
              required
            >
              <SelectTrigger className="w-[140px] h-9">
                <SelectValue placeholder="Select Role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ADMIN">Admin</SelectItem>
                <SelectItem value="RESPONDER">Responder</SelectItem>
                <SelectItem value="AUDITOR">Auditor</SelectItem>
                <SelectItem value="USER">User</SelectItem>
              </SelectContent>
            </Select>
          </>
        )}

        <SubmitButton disabled={disabled || !selectedAction} />
      </fieldset>

      {disabled && (
        <span className="text-[10px] text-muted-foreground italic ml-2">(Admin only)</span>
      )}

      {(localError || state?.error) && (
        <span className="text-xs text-red-500 flex items-center gap-1 animate-in fade-in ml-2">
          <AlertCircle className="h-3 w-3" />
          {localError || state?.error}
        </span>
      )}
    </form>
  );
}
