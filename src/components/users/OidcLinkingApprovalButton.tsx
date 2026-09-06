'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Link2, Loader2, Unlink2 } from 'lucide-react';
import { notify as toast } from '@/lib/toast';
import { DropdownMenuItem } from '@/components/ui/shadcn/dropdown-menu';
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
  type OidcLinkingState,
} from '@/app/(app)/users/oidc-actions';

export default function OidcLinkingApprovalButton({
  userId,
  userName,
}: {
  userId: string;
  userName: string;
}) {
  const [state, setState] = useState<OidcLinkingState | 'loading'>('loading');
  const [pending, setPending] = useState(false);
  const [dialog, setDialog] = useState<'allow' | 'revoke' | null>(null);

  useEffect(() => {
    let active = true;
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
  }, [userId]);

  const confirmAllow = async () => {
    setPending(true);
    try {
      const result = await allowOidcLinking(userId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.alreadyLinked) {
        setState('linked');
        toast.info(`${userName} already has an OIDC identity linked.`);
        return;
      }
      setState('approved');
      toast.success(`OIDC linking allowed for ${userName}'s next verified sign-in.`);
    } catch {
      toast.error('Failed to allow OIDC linking.');
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
        if (result.alreadyLinked) setState('linked');
        toast.error(result.error);
        return;
      }
      setState('not-approved');
      toast.success(`OIDC linking approval revoked for ${userName}.`);
    } catch {
      toast.error('Failed to revoke OIDC linking approval.');
    } finally {
      setPending(false);
      setDialog(null);
    }
  };

  return (
    <>
      {state === 'loading' ? (
        <DropdownMenuItem disabled>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          <span>Checking OIDC linking…</span>
        </DropdownMenuItem>
      ) : state === 'linked' ? (
        <DropdownMenuItem disabled className="text-emerald-700">
          <CheckCircle2 className="mr-2 h-4 w-4" />
          <span>OIDC linked</span>
        </DropdownMenuItem>
      ) : state === 'approved' ? (
        <DropdownMenuItem
          onSelect={event => {
            event.preventDefault();
            setDialog('revoke');
          }}
          className="text-orange-600 focus:text-orange-700"
        >
          <Unlink2 className="mr-2 h-4 w-4" />
          <span>Revoke OIDC linking approval</span>
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem
          onSelect={event => {
            event.preventDefault();
            setDialog('allow');
          }}
          className="text-blue-600 focus:text-blue-700"
        >
          <Link2 className="mr-2 h-4 w-4" />
          <span>Allow OIDC linking</span>
        </DropdownMenuItem>
      )}

      <AlertDialog open={dialog === 'allow'} onOpenChange={open => !open && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Allow OIDC linking?</AlertDialogTitle>
            <AlertDialogDescription>
              This allows <strong>{userName}</strong> to connect their existing OpsKnight account
              to a verified identity from the configured OIDC provider on their next sign-in.
              Their role, account status, and password are not changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmAllow} disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Allow linking
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
