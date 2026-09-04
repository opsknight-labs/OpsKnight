'use client';

import Link from 'next/link';
import { ReactNode, useEffect, useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import { RefreshCw, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface WidgetAction {
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  href?: string;
  variant?: 'primary' | 'secondary' | 'danger';
}

interface SidebarWidgetProps {
  title: string;
  icon: ReactNode;
  iconBg: string; // Now accepts Tailwind classes e.g. "bg-emerald-600"
  children: ReactNode;
  actions?: WidgetAction[];
  isLoading?: boolean;
  lastUpdated?: Date;
  onRefresh?: () => void;
  subtitle?: string;
}

// Enhanced Icon backgrounds using Tailwind classes and gradient definitions
export const WIDGET_ICON_BG = {
  green: 'emerald',
  blue: 'blue',
  orange: 'amber',
  purple: 'violet',
  red: 'red',
  slate: 'slate',
  cyan: 'cyan',
};

function getWidgetTheme(color?: string): {
  iconBg: string;
  iconText: string;
  border: string;
} | null {
  switch (color) {
    case 'emerald':
    case 'green':
      return {
        iconBg: 'bg-emerald-100',
        iconText: 'text-emerald-600',
        border: 'border-emerald-200/50',
      };
    case 'blue':
      return {
        iconBg: 'bg-blue-100',
        iconText: 'text-blue-600',
        border: 'border-blue-200/50',
      };
    case 'amber':
    case 'orange':
      return {
        iconBg: 'bg-amber-100',
        iconText: 'text-amber-600',
        border: 'border-amber-200/50',
      };
    case 'violet':
    case 'purple':
      return {
        iconBg: 'bg-violet-100',
        iconText: 'text-violet-600',
        border: 'border-violet-200/50',
      };
    case 'red':
      return {
        iconBg: 'bg-rose-100',
        iconText: 'text-rose-600',
        border: 'border-rose-200/50',
      };
    case 'slate':
      return {
        iconBg: 'bg-slate-100',
        iconText: 'text-slate-600',
        border: 'border-slate-200/50',
      };
    case 'cyan':
      return {
        iconBg: 'bg-cyan-100',
        iconText: 'text-cyan-600',
        border: 'border-cyan-200/50',
      };
    default:
      return null;
  }
}

/**
 * Widget Component - Minimal Modern Design (Matching Ops Pulse / Heatmap)
 */
export default function SidebarWidget({
  title,
  icon,
  iconBg,
  children,
  actions,
  isLoading,
  lastUpdated,
  onRefresh,
  subtitle,
}: SidebarWidgetProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const iconTheme = getWidgetTheme(iconBg);

  return (
    <div
      className={cn(
        'rounded-2xl border border-border bg-card shadow-xs transition-all duration-200 overflow-hidden'
      )}
    >
      {/* Header */}
      <div className="p-4 pb-3 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'w-10 h-10 rounded-xl flex items-center justify-center',
                iconTheme ? cn(iconTheme.iconBg, iconTheme.iconText) : 'bg-primary/10 text-primary'
              )}
            >
              {icon}
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">{title}</h3>
              {subtitle && (
                <p className="text-[10px] text-muted-foreground font-medium">{subtitle}</p>
              )}
              {/* Last Updated Indicator */}
              {mounted && lastUpdated && (
                <p className="text-[10px] text-slate-400 font-medium">
                  Updated {getTimeAgo(lastUpdated)}
                </p>
              )}
            </div>
          </div>

          {/* Actions */}
          {(actions || onRefresh) && (
            <div className="flex gap-2 items-center">
              {onRefresh && (
                <Button
                  onClick={onRefresh}
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600"
                  title="Refresh data"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              )}
              {actions?.map((action, idx) => {
                const buttonContent = (
                  <>
                    {action.icon}
                    <span className="text-[10px] font-semibold">{action.label}</span>
                  </>
                );

                const buttonClasses = cn(
                  'h-7 gap-1.5 px-2.5 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors'
                );

                if (action.href) {
                  return (
                    <Link
                      key={idx}
                      href={action.href}
                      className={cn('flex items-center', buttonClasses)}
                    >
                      {buttonContent}
                    </Link>
                  );
                }

                return (
                  <button
                    key={idx}
                    onClick={action.onClick}
                    className={cn('flex items-center', buttonClasses)}
                  >
                    {buttonContent}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="p-4">
        {/* Loading State */}
        {isLoading ? (
          <div className="py-6 text-center text-muted-foreground">
            <Loader2 className="h-5 w-5 mx-auto mb-2 animate-spin text-slate-400" />
            <p className="text-xs text-slate-400">Loading...</p>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

/**
 * Formats a Date object as a human-readable relative time string
 */
function getTimeAgo(date: Date | null | undefined): string {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    return 'unknown';
  }

  const now = Date.now();
  const then = date.getTime();
  const diffMs = now - then;

  if (diffMs < 0) {
    return 'just now';
  }

  const seconds = Math.floor(diffMs / 1000);

  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString();
}
