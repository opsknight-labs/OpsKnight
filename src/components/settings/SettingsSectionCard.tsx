'use client';

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/shadcn/card';
import { cn } from '@/lib/utils';

type Props = {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

export default function SettingsSectionCard({
  title,
  description,
  action,
  children,
  className,
}: Props) {
  return (
    <Card
      className={cn('bg-white border-slate-200 shadow-sm rounded-xl overflow-hidden', className)}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-4 border-b border-slate-100">
        <div className="space-y-1">
          <CardTitle className="text-base font-bold text-foreground tracking-tight">
            {title}
          </CardTitle>
          {description && (
            <CardDescription className="text-xs text-muted-foreground leading-relaxed">
              {description}
            </CardDescription>
          )}
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </CardHeader>
      <CardContent className="p-4 md:p-6">{children}</CardContent>
    </Card>
  );
}
