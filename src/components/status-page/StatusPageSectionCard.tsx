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
        'status-page-config-card bg-card text-card-foreground border border-border shadow-xs rounded-xl overflow-hidden transition-all',
        className
      )}
    >
      <CardHeader className="status-page-card-header px-4.5 py-3 md:px-5 md:py-3.5 bg-muted/40 border-b border-border">
        <div className="flex flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {icon && (
              <div className="status-page-card-icon-badge flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 shrink-0 ring-1 ring-indigo-500/20">
                {icon}
              </div>
            )}
            <div className="space-y-0.5 min-w-0">
              <CardTitle className="text-base font-semibold tracking-tight text-foreground truncate">
                {title}
              </CardTitle>
              {description && (
                <CardDescription className="text-xs text-muted-foreground leading-normal line-clamp-2">
                  {description}
                </CardDescription>
              )}
            </div>
          </div>
          {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
        </div>
      </CardHeader>
      <CardContent className={cn('p-4.5 md:p-5 space-y-4', contentClassName)}>
        {children}
      </CardContent>
      {footer && (
        <>
          <Separator className="border-border" />
          <div className="status-page-card-footer px-4.5 py-2.5 md:px-5 md:py-3 bg-muted/20 text-xs text-muted-foreground flex items-center justify-between gap-3">
            {footer}
          </div>
        </>
      )}
    </Card>
  );
}

export default StatusPageSectionCard;
