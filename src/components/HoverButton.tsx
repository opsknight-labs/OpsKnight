'use client';

import { type ReactNode, type ButtonHTMLAttributes } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import { cn } from '@/lib/utils';

type HoverButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  hoverClassName?: string;
};

export default function HoverButton({
  children,
  className,
  hoverClassName,
  variant = 'default',
  size = 'default',
  type = 'button',
  ...props
}: HoverButtonProps) {
  return (
    <Button
      type={type}
      variant={variant}
      size={size}
      className={cn(
        'transition-all duration-200',
        hoverClassName && `hover:${hoverClassName}`,
        className
      )}
      {...props}
    >
      {children}
    </Button>
  );
}
