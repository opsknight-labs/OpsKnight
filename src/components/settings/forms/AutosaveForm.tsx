'use client';

import { useForm, FormProvider, type FieldValues, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { useEffect } from 'react';
import { useAutosave } from '@/lib/hooks/use-autosave';
import { SaveIndicator } from '../feedback/SaveIndicator';
import { cn } from '@/lib/utils';
import { notify as toast } from '@/lib/toast';

interface AutosaveFormProps<T extends FieldValues> {
  defaultValues: T;
  onSave: (data: T) => Promise<{ success: boolean; error?: string }>;
  schema: z.ZodType<T>;
  children: (form: UseFormReturn<T>) => React.ReactNode;
  className?: string;
  showSaveIndicator?: boolean;
  saveIndicatorPosition?: 'top-right' | 'bottom-right' | 'inline';
  delay?: number;
  enabled?: boolean;
}

export function AutosaveForm<T extends FieldValues>({
  defaultValues,
  onSave,
  schema,
  children,
  className,
  showSaveIndicator = true,
  saveIndicatorPosition = 'top-right',
  delay = 500,
  enabled = true,
}: AutosaveFormProps<T>) {
  const form = useForm<T>({
    // @ts-expect-error - Zod resolver type compatibility with react-hook-form
    resolver: zodResolver(schema),
    // @ts-expect-error - defaultValues type compatibility
    defaultValues,
    mode: 'onChange',
  });

  const { watch, formState } = form;
  const watchedData = watch();

  const { status, error, isSaving } = useAutosave({
    data: watchedData,
    onSave,
    delay,
    enabled: enabled && formState.isValid,
  });

  // Show toast on error
  useEffect(() => {
    if (status === 'error' && error) {
      toast.error(error);
    }
  }, [status, error]);

  const indicatorClasses = {
    'top-right': 'absolute top-4 right-4',
    'bottom-right': 'absolute bottom-4 right-4',
    inline: 'mt-2',
  };

  return (
    <FormProvider {...form}>
      <div className={cn('relative', className)}>
        {showSaveIndicator && (
          <SaveIndicator
            status={status}
            error={error}
            className={indicatorClasses[saveIndicatorPosition]}
          />
        )}
        <form
          onSubmit={e => {
            e.preventDefault();
            // Auto-save handles submission, but we prevent default form submission
          }}
          className="space-y-6"
        >
          {/* @ts-expect-error - form type compatibility */}
          {children(form)}
        </form>
      </div>
    </FormProvider>
  );
}
