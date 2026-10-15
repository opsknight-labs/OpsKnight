'use client';

import { AlertTriangle, CheckCircle2, Clock3, ShieldX } from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  oidcProofLabel,
  type OidcProofState,
  type OidcProofStatus,
} from '@/lib/auth-control/proof-status';

export function formatAuthenticationDate(value: string | null | undefined) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function toneClass(state: OidcProofState) {
  if (state === 'valid')
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (state === 'trust-mismatch') return 'border-destructive/30 bg-destructive/10 text-destructive';
  return 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300';
}

/** Compact, server-derived verification badge. Never infers validity from a timestamp. */
export function AuthenticationVerificationBadge({
  verification,
  compact = false,
}: {
  verification: OidcProofStatus;
  compact?: boolean;
}) {
  const state = verification.state;
  const Icon =
    state === 'valid'
      ? CheckCircle2
      : state === 'trust-mismatch'
        ? ShieldX
        : state === 'expired'
          ? Clock3
          : AlertTriangle;
  const label =
    state === 'valid' && !compact && verification.expiresAt
      ? `Verified — expires ${formatAuthenticationDate(verification.expiresAt)}`
      : oidcProofLabel(state).short;
  return (
    <Badge
      variant="outline"
      className={`max-w-full gap-1 text-[11px] font-medium whitespace-normal text-left ${toneClass(state)}`}
      title={oidcProofLabel(state).detail}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span className="min-w-0">{label}</span>
    </Badge>
  );
}

/** Badge plus the explanation, for places with room to say what to do next. */
export function AuthenticationVerificationSummary({
  verification,
}: {
  verification: OidcProofStatus;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <AuthenticationVerificationBadge verification={verification} />
      <p className="text-xs text-muted-foreground leading-relaxed">
        {verification.state === 'valid' && verification.verifiedAt
          ? `Tested ${formatAuthenticationDate(verification.verifiedAt)}. Verification stays valid for seven days while the provider, administrator and sign-in origin are unchanged.`
          : oidcProofLabel(verification.state).detail}
      </p>
    </div>
  );
}
