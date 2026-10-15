'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Clock3, Link2, Loader2, RotateCcw, Unlink2 } from 'lucide-react';
import { notify as toast } from '@/lib/toast';
import { DropdownMenuItem } from '@/components/ui/shadcn/dropdown-menu';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/shadcn/alert-dialog';
import {
  allowOidcLinking,
  getOidcLinkingState,
  revokeOidcLinking,
} from '@/app/(app)/users/oidc-actions';
import type { OidcLinkingState } from '@/lib/oidc-linking-approval';

export default function OidcLinkingApprovalButton({
  userId,
  userName,
  initialState,
  variant = 'dropdown',
  onStateChange,
}: {
  userId: string;
  userName: string;
  initialState?: OidcLinkingState;
  variant?: 'dropdown' | 'button';
  onStateChange?: (state: OidcLinkingState) => void;
}) {
  const [state, setState] = useState<OidcLinkingState | 'loading'>(initialState ?? 'loading');
  const [pending, setPending] = useState(false);
  const [dialog, setDialog] = useState<'allow' | 'revoke' | null>(null);

  useEffect(() => {
    let active = true;
    if (initialState) {
      setState(initialState);
      return;
    }
    getOidcLinkingState(userId)
      .then(result => {
        if (!active) return;
        if (result.error || !result.state) {
          setState('not-approved');
          return;
        }
        setState(result.state);
      })
      .catch(() => {
        if (active) setState('not-approved');
      });
    return () => {
      active = false;
    };
  }, [userId, initialState]);

  const confirmAllow = async () => {
    const wasExpired = state === 'expired';
    const wasRevoked = state === 'revoked';
    setPending(true);
    try {
      const result = await allowOidcLinking(userId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.alreadyLinked) {
        setState('linked');
        onStateChange?.('linked');
        toast.info(`${userName} already has an OIDC identity linked.`);
        return;
      }
      setState('approved');
      onStateChange?.('approved');
      toast.success(
        wasExpired || wasRevoked || result.renewed
          ? `OIDC linking approval renewed for ${userName}.`
          : `OIDC linking allowed for ${userName}'s next verified sign-in.`
      );
    } catch {
      toast.error(wasExpired ? 'Failed to renew OIDC linking approval.' : 'Failed to allow OIDC linking.');
    } finally {
      setPending(false);
      setDialog(null);
    }
  };

  const confirmRevoke = async () => {
    setPending(true);
    try {
      const result = await revokeOidcLinking(userId);
      if (result.error) {
        if (result.alreadyLinked) {
          setState('linked');
          onStateChange?.('linked');
        }
        toast.error(result.error);
        return;
      }
      const nextState = result.state ?? 'revoked';
      setState(nextState);
      onStateChange?.(nextState);
      toast.success(`OIDC linking approval revoked for ${userName}.`);
    } catch {
      toast.error('Failed to revoke OIDC linking approval.');
    } finally {
      setPending(false);
      setDialog(null);
    }
  };

  const isRenewal = state === 'expired' || state === 'revoked' || state === 'stale';

  const renderTrigger = () => {
    if (variant === 'button') {
      if (state === 'loading') {
        return (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Checking…</span>
          </span>
        );
      }
      if (state === 'linked') {
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Identity linked</span>
          </span>
        );
      }
      if (state === 'approved') {
        return (
          <div className="flex items-center gap-1.5">
            <Badge
              variant="outline"
              className="bg-blue-500/10 text-blue-600 border-blue-500/20 dark:text-blue-400 text-xs py-0"
            >
              Approved
            </Badge>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDialog('revoke')}
              disabled={pending}
              className="h-6 px-1.5 text-xs text-muted-foreground hover:text-orange-600 dark:hover:text-orange-400"
              title="Revoke linking approval"
            >
              <Unlink2 className="h-3 w-3 mr-1" />
              Revoke
            </Button>
          </div>
        );
      }
      if (state === 'expired' || state === 'stale') {
        return (
          <div className="flex items-center gap-1.5">
            <Badge
              variant="outline"
              className="bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-400 text-xs py-0"
            >
              {state === 'expired' ? 'Expired' : 'Outdated'}
            </Badge>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDialog('allow')}
              disabled={pending}
              className="h-6 px-2 text-xs text-amber-700 border-amber-500/30 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/40"
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              Renew
            </Button>
          </div>
        );
      }
      if (state === 'revoked') {
        return (
          <div className="flex items-center gap-1.5">
            <Badge
              variant="outline"
              className="bg-zinc-500/10 text-zinc-600 border-zinc-500/20 dark:text-zinc-400 text-xs py-0"
            >
              Revoked
            </Badge>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDialog('allow')}
              disabled={pending}
              className="h-6 px-2 text-xs text-blue-600 border-blue-400/30 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              Reapprove
            </Button>
          </div>
        );
      }
      return (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setDialog('allow')}
          disabled={pending}
          className="h-7 px-2.5 text-xs font-medium text-blue-600 border-blue-500/30 hover:bg-blue-50 hover:text-blue-700 dark:text-blue-400 dark:hover:bg-blue-950/40"
        >
          <Link2 className="h-3.5 w-3.5 mr-1" />
          Allow linking
        </Button>
      );
    }

    if (state === 'loading') {
      return (
        <DropdownMenuItem disabled>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          <span>Checking OIDC linking…</span>
        </DropdownMenuItem>
      );
    }
    if (state === 'linked') {
      return (
        <DropdownMenuItem disabled className="text-emerald-700">
          <CheckCircle2 className="mr-2 h-4 w-4" />
          <span>OIDC linked</span>
        </DropdownMenuItem>
      );
    }
    if (state === 'approved') {
      return (
        <DropdownMenuItem
          onSelect={event => {
            event.preventDefault();
            setDialog('revoke');
          }}
          className="text-orange-600 focus:text-orange-700"
        >
          <Unlink2 className="mr-2 h-4 w-4" />
          <span>Approved — Revoke OIDC linking</span>
        </DropdownMenuItem>
      );
    }
    if (state === 'expired') {
      return (
        <DropdownMenuItem
          onSelect={event => {
            event.preventDefault();
            setDialog('allow');
          }}
          className="text-amber-700 focus:text-amber-800"
        >
          <Clock3 className="mr-2 h-4 w-4" />
          <span>Expired — Renew approval</span>
        </DropdownMenuItem>
      );
    }
    if (state === 'stale') {
      return (
        <DropdownMenuItem
          onSelect={event => {
            event.preventDefault();
            setDialog('allow');
          }}
          className="text-amber-700 focus:text-amber-800"
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          <span>Config changed — Renew approval</span>
        </DropdownMenuItem>
      );
    }
    if (state === 'revoked') {
      return (
        <DropdownMenuItem
          onSelect={event => {
            event.preventDefault();
            setDialog('allow');
          }}
          className="text-blue-600 focus:text-blue-700"
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          <span>Revoked — Reapprove OIDC linking</span>
        </DropdownMenuItem>
      );
    }
    return (
      <DropdownMenuItem
        onSelect={event => {
          event.preventDefault();
          setDialog('allow');
        }}
        className="text-blue-600 focus:text-blue-700"
      >
        <Link2 className="mr-2 h-4 w-4" />
        <span>Not approved — Allow OIDC linking</span>
      </DropdownMenuItem>
    );
  };

  return (
    <>
      {renderTrigger()}

      <AlertDialog open={dialog === 'allow'} onOpenChange={open => !open && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isRenewal ? 'Renew OIDC linking approval?' : 'Allow OIDC linking?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {isRenewal ? 'This issues a fresh, time-limited administrator approval for ' : 'This allows '}
              <strong>{userName}</strong>
              {isRenewal
                ? ' and invalidates the previous approval generation.'
                : ' to connect their existing OpsKnight account to a verified identity from the configured OIDC provider on their next sign-in.'}{' '}
              Their role, account status, and password are not changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmAllow} disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isRenewal ? 'Renew approval' : 'Allow linking'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={dialog === 'revoke'} onOpenChange={open => !open && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke OIDC linking approval?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{userName}</strong> will no longer be allowed to establish a new OIDC
              identity link. Existing password access, role, and account status are not affected.
              This does not unlink an identity that has already been established.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRevoke}
              disabled={pending}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Revoke approval
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
