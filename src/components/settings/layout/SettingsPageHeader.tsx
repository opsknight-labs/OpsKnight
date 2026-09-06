'use client';

import Link from 'next/link';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Breadcrumb {
  label: string;
  href: string;
}

interface SettingsPageHeaderProps {
  title: string;
  description?: string;
  backHref?: string;
  backLabel?: string;
  actions?: React.ReactNode;
  breadcrumbs?: Breadcrumb[];
  badge?: React.ReactNode;
  className?: string;
}

export function SettingsPageHeader({
  title,
  description,
  backHref = '/settings',
  backLabel = 'Settings',
  actions,
  breadcrumbs,
  badge,
  className,
}: SettingsPageHeaderProps) {
  return (
    <header className={cn('relative space-y-3 pb-6 border-b border-slate-200/80', className)}>
      {/* Navigation Breadcrumb / Back link */}
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {backHref && (
          <Link
            href={backHref}
            className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>{backLabel}</span>
          </Link>
        )}

        {breadcrumbs && breadcrumbs.length > 0 && (
          <>
            <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
            <nav aria-label="Breadcrumb" className="flex items-center gap-1.5">
              {breadcrumbs.map((crumb, index) => (
                <span key={crumb.href} className="flex items-center gap-1.5">
                  {index > 0 && <ChevronRight className="h-3.5 w-3.5 text-slate-300" />}
                  {index === breadcrumbs.length - 1 ? (
                    <span className="text-foreground font-semibold">{crumb.label}</span>
                  ) : (
                    <Link href={crumb.href} className="hover:text-foreground transition-colors">
                      {crumb.label}
                    </Link>
                  )}
                </span>
              ))}
            </nav>
          </>
        )}
      </div>

      {/* Title, Badge, Description, and Actions */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl md:text-3xl font-extrabold text-foreground tracking-tight">
              {title}
            </h1>
            {badge && <div>{badge}</div>}
          </div>
          {description && (
            <p className="text-sm text-muted-foreground max-w-3xl leading-relaxed">{description}</p>
          )}
        </div>

        {actions && (
          <div className="flex items-center gap-2 flex-shrink-0 pt-1 sm:pt-0">{actions}</div>
        )}
      </div>
    </header>
  );
}

export default SettingsPageHeader;
