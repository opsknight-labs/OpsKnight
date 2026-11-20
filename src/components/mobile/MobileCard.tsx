'use client';

import type { KeyboardEvent, ReactNode } from 'react';
import { Card } from '@/components/ui/shadcn/card';
import { cn } from '@/lib/utils';

type MobileCardProps = {
  children: ReactNode;
  variant?: 'default' | 'elevated' | 'outlined' | 'gradient';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  onClick?: () => void;
  className?: string;
};

const paddingSizes = new Map<NonNullable<MobileCardProps['padding']>, string>([
  ['none', 'p-0'],
  ['sm', 'p-3'],
  ['md', 'p-4'],
  ['lg', 'p-5 sm:p-6'],
]);

const variantStyles = new Map<NonNullable<MobileCardProps['variant']>, string>([
  ['default', ''],
  ['elevated', 'shadow-md'],
  ['outlined', 'shadow-none'],
  ['gradient', 'bg-gradient-to-br from-card to-muted/40'],
]);

export default function MobileCard({
  children,
  variant = 'default',
  padding = 'md',
  onClick,
  className,
}: MobileCardProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <Card
      className={cn(
        'min-w-0 rounded-2xl border-border bg-card text-card-foreground',
        onClick && 'cursor-pointer transition-transform active:scale-[0.99]',
        variantStyles.get(variant),
        paddingSizes.get(padding),
        className
      )}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {children}
    </Card>
  );
}
