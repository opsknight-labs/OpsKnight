import { memo, type CSSProperties, type ReactNode } from 'react';
import { badgeVariants } from './shadcn/badge';
import { cn } from '@/lib/utils';

type BadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'error' | 'danger' | 'info';
type BadgeSize = 'xs' | 'sm' | 'md' | 'lg';

interface BadgeProps {
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

function variantClass(variant: BadgeVariant): string {
  switch (variant) {
    case 'primary':
      return 'bg-primary text-primary-foreground';
    case 'success':
      return 'bg-emerald-100 text-status-ok-deep dark:bg-status-ok/20 dark:text-emerald-300';
    case 'warning':
      return 'bg-amber-100 text-amber-800 dark:bg-status-elevated/20 dark:text-amber-300';
    case 'error':
    case 'danger':
      return 'bg-rose-100 text-status-critical-border dark:bg-status-critical/20 dark:text-rose-300';
    case 'info':
      return 'bg-blue-100 text-status-info-deep dark:bg-status-info/20 dark:text-blue-300';
    default:
      return 'bg-ink-200 text-ink-700';
  }
}

function sizeClass(size: BadgeSize): string {
  switch (size) {
    case 'xs':
      return 'h-4 px-1.5 text-2xs';
    case 'sm':
      return 'h-5 px-2 text-xs';
    case 'lg':
      return 'h-7 px-4 text-base';
    default:
      return 'h-6 px-3 text-sm';
  }
}

/**
 * Compatibility wrapper over the canonical shadcn badge recipe
 * (`@/components/ui/shadcn/badge`). Renders a `span`, so it is valid inside text.
 *
 * @example
 * <Badge variant="success" size="md" dot>Active</Badge>
 */
function Badge({
  variant = 'default',
  size = 'md',
  dot = false,
  children,
  className,
  style,
}: BadgeProps) {
  return (
    <span
      data-badge="true"
      className={cn(
        badgeVariants({ variant: 'outline' }),
        'ui-badge gap-1 whitespace-nowrap rounded-full border-transparent py-0 font-medium',
        `ui-badge-${variant} ui-badge-${size}`,
        sizeClass(size),
        variantClass(variant),
        className
      )}
      style={style}
    >
      {dot && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export default memo(Badge);
