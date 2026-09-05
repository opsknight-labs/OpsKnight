'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { getEmailValidationError } from '@/lib/form-validation';
import { getUserFacingErrorMessage } from '@/lib/user-facing-error';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/shadcn/select';
import { Button } from '@/components/ui/shadcn/button';
import {
  Mail,
  Shield,
  CheckCircle2,
  AlertCircle,
  Copy,
  Users,
  ShieldAlert,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type FormState = {
  error?: string | null;
  success?: boolean;
  inviteUrl?: string | null;
  emailSent?: boolean;
};

type Props = {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  className?: string;
  disabled?: boolean;
};

// Role descriptions for better UX
const ROLE_DESCRIPTIONS = {
  ADMIN: 'Full access to all settings and users',
  RESPONDER: 'Can manage incidents and view reports',
  AUDITOR: 'Organization-wide read-only access and audit evidence',
  USER: 'Standard access to view status and dashboards',
};

function SubmitButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      className="w-full max-w-full min-w-0 h-9 sm:h-10 font-semibold text-xs sm:text-sm transition-all duration-200 mt-2 gap-2 cursor-pointer"
      disabled={pending || disabled}
      variant={disabled ? 'secondary' : 'default'}
    >
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Sending Invite...</span>
        </>
      ) : (
        <>
          <Mail className="h-4 w-4" />
          <span>Send Invite</span>
        </>
      )}
    </Button>
  );
}

export default function UserCreateForm({ action, className = '', disabled = false }: Props) {
  const [state, formAction] = useActionState(action, {
    error: null,
    success: false,
    emailSent: false,
  });
  const formRef = useRef<HTMLFormElement | null>(null);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState('RESPONDER');
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    if (state?.success) {
      formRef.current?.reset();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEmail('');
      // Don't reset selectedRole, convenient for multiple adds
      setEmailError(null);
    }
  }, [state?.success]);

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setEmail(value);
    const error = getEmailValidationError(value);
    setEmailError(error);
  };

  const copyToClipboard = () => {
    if (state?.inviteUrl) {
      navigator.clipboard.writeText(state.inviteUrl);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  return (
    <div className={cn('relative w-full max-w-full min-w-0', className)}>
      <form ref={formRef} action={formAction} className="space-y-4 w-full max-w-full min-w-0">
        <fieldset
          disabled={disabled}
          className="space-y-4 border-none p-0 m-0 w-full max-w-full min-w-0 disabled:opacity-60"
          style={{ minWidth: 0 }}
        >
          {/* Name Field */}
          <div className="space-y-1.5 w-full max-w-full min-w-0">
            <Label
              htmlFor="name"
              className="text-xs font-semibold text-muted-foreground uppercase tracking-wider"
            >
              Full Name
            </Label>
            <Input
              id="name"
              name="name"
              required
              placeholder="e.g. Sarah Connor"
              className="h-9 sm:h-10 text-sm bg-background border-input transition-colors focus-visible:ring-1 focus-visible:ring-primary w-full min-w-0"
              maxLength={200}
            />
          </div>

          {/* Email Field */}
          <div className="space-y-1.5 w-full max-w-full min-w-0">
            <div className="flex justify-between items-center">
              <Label
                htmlFor="email"
                className="text-xs font-semibold text-muted-foreground uppercase tracking-wider"
              >
                Email Address
              </Label>
              {email && !emailError && (
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium animate-in fade-in slide-in-from-left-2">
                  <CheckCircle2 className="h-3 w-3" /> Valid
                </span>
              )}
            </div>
            <Input
              id="email"
              name="email"
              required
              type="email"
              placeholder="sarah@company.com"
              className={cn(
                'h-9 sm:h-10 text-sm bg-background border-input transition-colors focus-visible:ring-1 focus-visible:ring-primary w-full min-w-0',
                emailError && 'border-destructive focus-visible:ring-destructive text-destructive'
              )}
              maxLength={320}
              value={email}
              onChange={handleEmailChange}
            />
            {emailError && (
              <p className="text-xs text-destructive font-medium flex items-center gap-1 mt-1 animate-in fade-in slide-in-from-top-1">
                <AlertCircle className="h-3 w-3 shrink-0" /> {emailError}
              </p>
            )}
          </div>

          {/* Role Field */}
          <div className="space-y-1.5 w-full max-w-full min-w-0">
            <Label
              htmlFor="role"
              className="text-xs font-semibold text-muted-foreground uppercase tracking-wider"
            >
              Role Permission
            </Label>
            <input type="hidden" name="role" value={selectedRole} />
            <Select value={selectedRole} onValueChange={setSelectedRole} disabled={disabled}>
              <SelectTrigger className="h-auto py-2 px-3 w-full bg-background border-input items-center min-w-0">
                <div className="flex items-center gap-2.5 text-left min-w-0 flex-1">
                  {selectedRole === 'ADMIN' ? (
                    <div className="p-1.5 bg-purple-500/10 text-purple-600 dark:text-purple-400 rounded-md shrink-0">
                      <ShieldAlert className="h-4 w-4" />
                    </div>
                  ) : selectedRole === 'RESPONDER' ? (
                    <div className="p-1.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-md shrink-0">
                      <Shield className="h-4 w-4" />
                    </div>
                  ) : selectedRole === 'AUDITOR' ? (
                    <div className="p-1.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-md shrink-0">
                      <Shield className="h-4 w-4" />
                    </div>
                  ) : (
                    <div className="p-1.5 bg-muted text-muted-foreground rounded-md shrink-0">
                      <Users className="h-4 w-4" />
                    </div>
                  )}
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-semibold text-xs text-foreground">
                      {selectedRole.charAt(0) + selectedRole.slice(1).toLowerCase()}
                    </span>
                    <span className="text-[10px] text-muted-foreground truncate">
                      {ROLE_DESCRIPTIONS[selectedRole as keyof typeof ROLE_DESCRIPTIONS]}
                    </span>
                  </div>
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ADMIN" className="py-2">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1 bg-purple-500/10 text-purple-600 dark:text-purple-400 rounded-md shrink-0">
                      <ShieldAlert className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex flex-col">
                      <span className="font-medium text-xs">Admin</span>
                      <span className="text-[10px] text-muted-foreground">Full system control</span>
                    </div>
                  </div>
                </SelectItem>
                <SelectItem value="RESPONDER" className="py-2">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-md shrink-0">
                      <Shield className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex flex-col">
                      <span className="font-medium text-xs">Responder</span>
                      <span className="text-[10px] text-muted-foreground">Manage incidents</span>
                    </div>
                  </div>
                </SelectItem>
                <SelectItem value="AUDITOR" className="py-2">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-md shrink-0">
                      <Shield className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex flex-col">
                      <span className="font-medium text-xs">Auditor</span>
                      <span className="text-[10px] text-muted-foreground">
                        Organization-wide read access
                      </span>
                    </div>
                  </div>
                </SelectItem>
                <SelectItem value="USER" className="py-2">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1 bg-muted text-muted-foreground rounded-md shrink-0">
                      <Users className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex flex-col">
                      <span className="font-medium text-xs">User</span>
                      <span className="text-[10px] text-muted-foreground">View only access</span>
                    </div>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <SubmitButton disabled={disabled} />
        </fieldset>

        {disabled && (
          <div className="bg-muted/50 rounded-lg p-3 text-center border border-dashed">
            <p className="text-xs text-muted-foreground flex items-center justify-center gap-2">
              <ShieldAlert className="h-3 w-3" /> Only admins can invite new users
            </p>
          </div>
        )}

        {state?.error && (
          <div className="bg-destructive/10 text-destructive p-3 rounded-lg text-xs border border-destructive/20 flex items-start gap-2 animate-in fade-in slide-in-from-top-2 w-full max-w-full min-w-0">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <p className="leading-relaxed">{getUserFacingErrorMessage(state.error)}</p>
          </div>
        )}

        {state?.success && state?.inviteUrl && (
          <div className="bg-emerald-500/10 border border-emerald-500/25 dark:bg-emerald-950/20 dark:border-emerald-800/40 rounded-xl p-3.5 sm:p-4 space-y-2.5 animate-in fade-in slide-in-from-bottom-2 w-full max-w-full min-w-0">
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-semibold text-xs sm:text-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>User Invited Successfully!</span>
            </div>
            {state.emailSent && (
              <p className="text-[11px] text-muted-foreground leading-relaxed pl-6">
                Invitation email sent to the user.
              </p>
            )}

            <div className="bg-background border border-border/80 rounded-lg p-1.5 flex items-center gap-2 shadow-2xs w-full max-w-full min-w-0">
              <code
                className="text-[11px] sm:text-xs flex-1 min-w-0 truncate font-mono bg-muted/60 px-2 py-1 rounded text-foreground/90 select-all"
                title={state.inviteUrl}
              >
                {state.inviteUrl}
              </code>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={copyToClipboard}
                className={cn(
                  'h-7 px-2.5 shrink-0 text-xs font-medium gap-1.5 transition-all shadow-2xs cursor-pointer',
                  isCopied && 'text-emerald-600 bg-emerald-500/15 border-emerald-500/30'
                )}
              >
                {isCopied ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copy</span>
                  </>
                )}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed pl-6">
              Share this link with them. They need it to set up their account password.
            </p>
          </div>
        )}
        {state?.success && !state?.inviteUrl && (
          <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-lg p-3 flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300 animate-in fade-in slide-in-from-bottom-2 w-full max-w-full min-w-0">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>Invitation sent via email!</span>
          </div>
        )}
      </form>
    </div>
  );
}
