'use client';

import { useActionState, useState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { signOut } from 'next-auth/react';
import { updatePassword } from '@/app/(app)/settings/actions';
import PasswordStrength from './PasswordStrength';
import { SettingsRow } from '@/components/settings/layout/SettingsRow';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import { AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Lock } from 'lucide-react';
import { isPasswordStrong } from '@/lib/password-strength';

type Props = {
  hasPassword: boolean;
};

type State = {
  error?: string | null;
  success?: boolean;
};

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled} className="gap-2">
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Updating Password...
        </>
      ) : (
        <>
          <KeyRound className="h-4 w-4" />
          Update Password
        </>
      )}
    </Button>
  );
}

export default function SecurityForm({ hasPassword }: Props) {
  const [state, formAction] = useActionState<State, FormData>(updatePassword, {
    error: null,
    success: false,
  });

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Sign out and redirect after successful password update
  useEffect(() => {
    if (state?.success) {
      const timer = setTimeout(async () => {
        await signOut({ callbackUrl: '/login' });
      }, 1800);
      return () => clearTimeout(timer);
    }
  }, [state?.success]);

  const passwordsMatch = confirmPassword.length > 0 && newPassword === confirmPassword;
  const isStrong = isPasswordStrong(newPassword, 4);
  const canSubmit = (!hasPassword || currentPassword.length > 0) && isStrong && passwordsMatch;

  return (
    <form action={formAction} className="space-y-6">
      <div className="divide-y text-sm">
        {hasPassword && (
          <SettingsRow
            label="Current Password"
            description="Confirm your existing credentials to authenticate this change"
            htmlFor="currentPassword"
            required
          >
            <div className="relative max-w-md w-full">
              <Input
                type={showCurrentPassword ? 'text' : 'password'}
                id="currentPassword"
                name="currentPassword"
                autoComplete="current-password"
                required
                placeholder="Enter current password"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(prev => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                aria-label={showCurrentPassword ? 'Hide current password' : 'Show current password'}
              >
                {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </SettingsRow>
        )}

        <SettingsRow
          label={hasPassword ? 'New Password' : 'Create Password'}
          description="Use an enterprise-grade password with uppercase letters, numbers, and symbols"
          htmlFor="newPassword"
          required
          tooltip="Must meet strong security criteria (8+ characters, uppercase, lowercase, numbers, symbols)"
        >
          <div className="max-w-md w-full space-y-3">
            <div className="relative">
              <Input
                type={showNewPassword ? 'text' : 'password'}
                id="newPassword"
                name="newPassword"
                autoComplete="new-password"
                required
                placeholder="Enter new strong password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(prev => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
              >
                {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <PasswordStrength password={newPassword} />
          </div>
        </SettingsRow>

        <SettingsRow
          label="Confirm New Password"
          description="Re-enter your new password to verify accuracy"
          htmlFor="confirmPassword"
          required
        >
          <div className="max-w-md w-full space-y-1.5">
            <div className="relative">
              <Input
                type={showConfirmPassword ? 'text' : 'password'}
                id="confirmPassword"
                name="confirmPassword"
                autoComplete="new-password"
                required
                placeholder="Re-enter new password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(prev => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {confirmPassword.length > 0 && (
              <p
                className={`text-xs font-medium flex items-center gap-1.5 ${
                  passwordsMatch
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {passwordsMatch ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Passwords match
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-3.5 w-3.5" />
                    Passwords do not match
                  </>
                )}
              </p>
            )}
          </div>
        </SettingsRow>
      </div>

      {state?.error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      {state?.success && (
        <Alert className="bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <AlertDescription>
            Password updated successfully. You will be automatically redirected to sign in with your
            new credentials...
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5" />
          <span>Updating password immediately invalidates all other active sessions</span>
        </div>
        <SubmitButton disabled={!canSubmit} />
      </div>
    </form>
  );
}
