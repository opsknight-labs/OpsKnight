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
        info: 'border-transparent bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-sm',
        success:
          'border-transparent bg-gradient-to-r from-emerald-500 to-green-600 text-white shadow-sm',
        warning:
          'border-transparent bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-sm',
        danger: 'border-transparent bg-gradient-to-r from-red-500 to-rose-600 text-white shadow-sm',
        // Sidebar variants - solid colors with white text for dark backgrounds
        'sidebar-danger': 'border-red-500 bg-red-500 text-white',
        'sidebar-info': 'border-blue-500 bg-blue-500 text-white',
        'sidebar-success': 'border-emerald-500 bg-emerald-500 text-white',
        'sidebar-warning': 'border-amber-500 bg-amber-500 text-white',
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
    <div data-badge="true" className={cn(badgeVariants({ variant, size }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
