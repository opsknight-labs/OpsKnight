'use client';

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import SetPasswordForm from './SetPasswordForm';
import { AuthCard, AuthLayout } from '@/components/auth/AuthLayout';
import AuthBrand from '@/components/auth/AuthBrand';
import { useCapabilityToken } from '@/components/auth/useCapabilityToken';
import Spinner from '@/components/ui/Spinner';

function InviteActivation() {
  const { token, ready: tokenReady } = useCapabilityToken();

  if (!tokenReady) {
    return (
      <div className="flex justify-center p-8">
        <Spinner />
      </div>
    );
  }

  if (!token) {
    return (
      <div className="space-y-5">
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-status-elevated/30 bg-status-elevated-soft p-4 text-sm"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-elevated" />
          <div>
            <p className="font-medium text-status-elevated-deep">Missing invitation</p>
            <p className="mt-1 text-xs text-status-elevated-deep/80">
              Open the complete invitation link from your administrator or email.
            </p>
          </div>
        </div>
        <Link
          href="/login"
          className="flex w-full items-center justify-center rounded-xl border border-border py-3 text-sm font-medium text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return <SetPasswordForm token={token} />;
}

export default function SetPasswordPage() {
  return (
    <AuthLayout>
      <AuthCard>
        <div className="mb-8 text-center">
          <AuthBrand className="mb-6" />
          <h1 className="font-display text-2xl font-bold text-foreground">
            Complete your invitation
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Set a secure passphrase to activate your OpsKnight account.
          </p>
        </div>
        <InviteActivation />
      </AuthCard>
    </AuthLayout>
  );
}
