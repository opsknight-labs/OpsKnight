'use client';

import { cn } from '@/lib/utils';
import { HelpCircle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/shadcn/tooltip';

interface SettingsRowProps {
  label: string;
  description?: string;
  tooltip?: string;
  children: React.ReactNode;
  className?: string;
  required?: boolean;
  /** Id of the control; also prefixes `<id>-description` / `<id>-error` for `aria-describedby`. */
  htmlFor?: string;
  /** Inline validation message shown under the control. */
  error?: string;
}

/** Ids a control inside `SettingsRow` should reference from `aria-describedby`. */
export function settingsRowDescribedBy(
  htmlFor: string,
  { description, error }: { description?: boolean; error?: boolean }
): string | undefined {
  const ids = [description && `${htmlFor}-description`, error && `${htmlFor}-error`].filter(
    Boolean
  );
  return ids.length ? ids.join(' ') : undefined;
}

export function SettingsRow({
  label,
  description,
  tooltip,
  children,
  className,
  required,
  htmlFor,
  error,
}: SettingsRowProps) {
  return (
    <div
      className={cn(
        'grid gap-4 py-4 border-b border-border last:border-0',
        'md:grid-cols-[40%_1fr] md:gap-6 md:py-5',
        className
      )}
    >
      {/* Left column - Label and description */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <label
            htmlFor={htmlFor}
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            {label}
            {required && (
              <span className="ml-1 text-destructive" aria-hidden="true">
                *
              </span>
            )}
            {required && <span className="sr-only"> (required)</span>}
          </label>
          {tooltip && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={`More information about ${label}`}
                    className="inline-flex rounded-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <HelpCircle aria-hidden="true" className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" align="start" className="max-w-xs leading-relaxed">
                  {tooltip}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        {description && (
          <p
            id={htmlFor ? `${htmlFor}-description` : undefined}
            className="text-sm text-muted-foreground leading-relaxed"
          >
            {description}
          </p>
        )}
      </div>

      {/* Right column - Control */}
      <div className="flex flex-col gap-2 pt-1 md:pt-0">
        <div className="flex items-start">{children}</div>
        {error && (
          <p
            id={htmlFor ? `${htmlFor}-error` : undefined}
            role="alert"
            className="text-xs font-medium text-destructive"
          >
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
