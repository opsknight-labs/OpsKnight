'use client';

import { Card } from '@/components/ui/shadcn/card';
import { Separator } from '@/components/ui/shadcn/separator';
import { cn } from '@/lib/utils';

interface SettingsSectionProps {
  /** Anchor id, so `#id` links can deep-link to the section. */
  id?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
  footer?: React.ReactNode;
}

export function SettingsSection({
  id,
  title,
  description,
  children,
  className,
  action,
  footer,
}: SettingsSectionProps) {
  return (
    <Card id={id} className={cn('overflow-hidden', id && 'scroll-mt-24', className)}>
      {/* Header */}
      <div className="px-4 py-4 md:px-6 md:py-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
          <div className="space-y-1">
            <h3 className="text-lg font-bold leading-none tracking-tight">{title}</h3>
            {description && (
              <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
            )}
          </div>
          {action && <div className="flex-shrink-0">{action}</div>}
        </div>
      </div>

      <Separator />

      {/* Content */}
      <div className="px-4 md:px-6">{children}</div>

      {/* Footer */}
      {footer && (
        <>
          <Separator />
          <div className="px-4 py-3 md:px-6 md:py-4 bg-muted/30">{footer}</div>
        </>
      )}
    </Card>
  );
}
