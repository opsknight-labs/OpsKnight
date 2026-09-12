'use client';

import React from 'react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/shadcn/card';
import { Separator } from '@/components/ui/shadcn/separator';
import { cn } from '@/lib/utils';

export interface StatusPageSectionCardProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

export function StatusPageSectionCard({
  title,
  description,
  icon,
  action,
  footer,
  children,
  className,
  contentClassName,
}: StatusPageSectionCardProps) {
  return (
    <Card
      className={cn(
        'bg-card text-card-foreground border-border/80 shadow-xs rounded-xl overflow-hidden transition-colors',
        className
      )}
    >
      <CardHeader className="px-5 py-4 md:px-6 md:py-4.5 bg-muted/15 border-b border-border/60">
        <div className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <CardTitle className="text-base md:text-lg font-bold tracking-tight text-foreground flex items-center gap-2.5">
              {icon && <span className="text-muted-foreground shrink-0">{icon}</span>}
              <span className="truncate">{title}</span>
            </CardTitle>
            {description && (
              <CardDescription className="text-xs md:text-sm text-muted-foreground leading-relaxed">
                {description}
              </CardDescription>
            )}
          </div>
          {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
        </div>
      </CardHeader>
      <CardContent className={cn('p-5 md:p-6 space-y-4', contentClassName)}>{children}</CardContent>
      {footer && (
        <>
          <Separator className="border-border/60" />
          <div className="px-5 py-3 md:px-6 md:py-3.5 bg-muted/25 text-xs text-muted-foreground flex items-center justify-between gap-3">
            {footer}
          </div>
        </>
      )}
    </Card>
  );
}

export default StatusPageSectionCard;
