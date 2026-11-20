'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import { Check, Copy, Link as LinkIcon } from 'lucide-react';
import { notify } from '@/lib/toast';
import { cn } from '@/lib/utils';

type CopyButtonProps = {
  text: string;
  label?: string;
  variant?: 'icon' | 'button';
  icon?: 'copy' | 'link';
  className?: string;
};

export default function CopyButton({
  text,
  label,
  variant = 'icon',
  icon = 'copy',
  className,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      notify.success('Copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      notify.error('Failed to copy');
    }
  };

  const Icon = icon === 'link' ? LinkIcon : Copy;

  if (variant === 'button') {
    return (
      <Button variant="outline" size="sm" onClick={handleCopy} className={cn('gap-2', className)}>
        {copied ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
        {label || (icon === 'link' ? 'Copy Link' : 'Copy ID')}
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleCopy}
      className={cn('h-6 w-6 text-muted-foreground hover:text-foreground', className)}
      title={label || 'Copy'}
    >
      {copied ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
    </Button>
  );
}
