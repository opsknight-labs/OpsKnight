'use client';

import { cn } from '@/lib/utils';
import { HelpCircle } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';

interface SettingsRowProps {
  label: string;
  description?: string;
  tooltip?: string;
  children: React.ReactNode;
  className?: string;
  required?: boolean;
  htmlFor?: string;
}

export function SettingsRow({
  label,
  description,
  tooltip,
  children,
  className,
  required,
  htmlFor,
}: SettingsRowProps) {
  return (
    <div
      className={cn(
        'grid gap-4 py-4 border-b border-border last:border-0',
        'md:grid-cols-[40%_1fr] md:gap-6 md:py-5',
        'transition-colors hover:bg-muted/30',
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
            {required && <span className="text-destructive ml-1">*</span>}
          </label>
          {tooltip && (
            <Tooltip content={tooltip} position="top">
              <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
            </Tooltip>
          )}
        </div>
        {description && (
          <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
        )}
      </div>

      {/* Right column - Control */}
      <div className="flex flex-col gap-2 pt-1 md:pt-0">
        <div className="flex items-start">{children}</div>
      </div>
    </div>
  );
}
