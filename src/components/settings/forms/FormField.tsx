'use client';

import {
  useFormContext,
  Controller,
  type ControllerRenderProps,
  type FieldValues,
} from 'react-hook-form';
import { Label } from '@/components/ui/shadcn/label';
import { cn } from '@/lib/utils';
import { HelpCircle } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';

interface FormFieldProps {
  name: string;
  label: string;
  description?: string;
  required?: boolean;
  tooltip?: string;
  children:
    | React.ReactNode
    | ((field: ControllerRenderProps<FieldValues, string>) => React.ReactNode);
  className?: string;
}

export function FormField({
  name,
  label,
  description,
  required,
  tooltip,
  children,
  className,
}: FormFieldProps) {
  const {
    control,
    formState: { errors },
  } = useFormContext();

  const error = errors[name];
  const errorMessage = error?.message as string | undefined;

  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <div className={cn('space-y-2', className)}>
          <div className="flex items-center gap-2">
            <Label htmlFor={name} className="text-sm font-medium">
              {label}
              {required && <span className="text-destructive ml-1">*</span>}
            </Label>
            {tooltip && (
              <Tooltip content={tooltip}>
                <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
              </Tooltip>
            )}
          </div>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
          {typeof children === 'function' ? children(field) : children}
          {errorMessage && <p className="text-xs text-destructive">{errorMessage}</p>}
        </div>
      )}
    />
  );
}

export default FormField;
