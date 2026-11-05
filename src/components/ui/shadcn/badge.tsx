import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center justify-center gap-1 rounded-md border px-2.5 py-0.5 text-[11px] font-bold leading-4 tracking-wide transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/90',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/90',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border-border text-foreground bg-transparent',
        neutral: 'border-transparent bg-slate-700 text-white shadow-sm',
        info: 'border-transparent bg-gradient-to-r from-status-info-deep to-status-info text-white shadow-sm',
        success:
          'border-transparent bg-gradient-to-r from-status-ok-deep to-status-ok text-white shadow-sm',
        warning:
          'border-transparent bg-gradient-to-r from-status-elevated-deep to-status-elevated text-white shadow-sm',
        danger: 'border-transparent bg-gradient-to-r from-status-critical-deep to-status-critical text-white shadow-sm',
        shift: 'border-transparent bg-gradient-to-r from-status-shift-deep to-status-shift text-white shadow-sm',
        // Sidebar variants - solid colors with white text for dark backgrounds
        'sidebar-danger': 'border-status-critical bg-status-critical text-white',
        'sidebar-info': 'border-status-info bg-status-info text-white',
        'sidebar-success': 'border-status-ok bg-status-ok text-white',
        'sidebar-warning': 'border-status-elevated bg-status-elevated text-white',
      },
      size: {
        xs: 'px-2 py-0.5 text-[10px]',
        sm: 'px-2.5 py-0.5 text-[11px]',
        md: 'px-3 py-1 text-xs',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'sm',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return (
    <div
      data-badge="true"
      data-variant={variant || 'default'}
      data-size={size || 'sm'}
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
