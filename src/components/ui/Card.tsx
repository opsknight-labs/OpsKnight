'use client';

import { ReactNode, HTMLAttributes } from 'react';
import {
  Card as ShadcnCard,
  CardHeader,
  CardContent,
  CardFooter,
} from '@/components/ui/shadcn/card';
import { cn } from '@/lib/utils';

type CardVariant = 'default' | 'elevated' | 'outlined' | 'flat';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  header?: ReactNode;
  footer?: ReactNode;
  hover?: boolean;
  children: ReactNode;
}

/**
 * Card component with header, body, and footer sections
 *
 * @example
 * <Card variant="elevated" header={<h3>Title</h3>} footer={<button>Action</button>}>
 *   Content here
 * </Card>
 */
export default function Card({
  variant = 'default',
  header,
  footer,
  hover = false,
  children,
  className = '',
  ...props
}: CardProps) {
  const variantClasses = {
    default: 'bg-card border border-border shadow-sm',
    elevated: 'bg-card border border-border shadow-lg',
    outlined: 'bg-card border-2 border-border shadow-none',
    flat: 'bg-transparent border-0 shadow-none',
  };

  return (
    <ShadcnCard
      className={cn(
        'rounded-lg overflow-hidden transition-all duration-200',
        variantClasses[variant],
        hover && 'hover:shadow-xl hover:-translate-y-0.5 cursor-pointer',
        className
      )}
      {...props}
    >
      {header && (
        <CardHeader className="p-6 border-b border-border bg-background">{header}</CardHeader>
      )}
      <CardContent className="p-6">{children}</CardContent>
      {footer && (
        <CardFooter className="p-6 border-t border-border bg-background">{footer}</CardFooter>
      )}
    </ShadcnCard>
  );
}
