'use client';

import { useId, useState, type ReactNode } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Checkbox } from '@/components/ui/shadcn/checkbox';
import { Label } from '@/components/ui/shadcn/label';
import CopyButton from './CopyButton';

/**
 * Shows a credential exactly once. The secret stays on screen until the user confirms they
 * stored it and dismisses the banner; dismissal removes it from the page. The parent owns the
 * secret in its own state and must drop it in `onDismiss`.
 */
export default function OneTimeSecretBanner({
  title,
  badge,
  secret,
  description,
  onDismiss,
}: {
  title: string;
  badge: string;
  secret: string;
  description: ReactNode;
  onDismiss: () => void;
}) {
  const [stored, setStored] = useState(false);
  const ackId = useId();

  return (
    <div
      role="region"
      aria-label={title}
      className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 space-y-4 shadow-sm animate-in fade-in-0 duration-200"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-bold text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <span>{title}</span>
        </div>
        <Badge
          variant="outline"
          className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 text-[10px] font-bold uppercase tracking-wider"
        >
          {badge}
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 rounded-xl border border-emerald-500/25 bg-background p-2.5 shadow-2xs">
        <code
          data-testid="one-time-secret"
          className="flex-1 text-xs font-mono font-bold text-foreground break-all px-2 select-all"
        >
          {secret}
        </code>
        <CopyButton text={secret} />
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Checkbox
            id={ackId}
            checked={stored}
            onCheckedChange={checked => setStored(checked === true)}
          />
          <Label htmlFor={ackId} className="text-xs font-medium">
            I have stored this secret. I understand it cannot be shown again.
          </Label>
        </div>
        <Button type="button" size="sm" disabled={!stored} onClick={onDismiss}>
          Dismiss and clear
        </Button>
      </div>
    </div>
  );
}
