'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { getEmailValidationError } from '@/lib/form-validation';
import { getUserFriendlyError } from '@/lib/user-friendly-errors';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
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
      className="w-full h-10 font-semibold text-sm transition-all duration-200 mt-2"
      disabled={pending || disabled}
      variant={disabled ? 'secondary' : 'default'}
    >
      {pending ? (
        <>
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          Sending Invite...
        </>
      ) : (
        <>
          <Mail className="mr-2 h-4 w-4" />
          Send Invite
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
    <div className={cn('relative', className)}>
      <form ref={formRef} action={formAction} className="space-y-4">
        <fieldset disabled={disabled} className="space-y-4 border-none p-0 m-0 disabled:opacity-60">
          {/* Name Field */}
          <div className="space-y-2">
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
              placeholder="John Doe"
              className="h-10 text-sm bg-background/50 border-input transition-colors focus:bg-background"
              maxLength={200}
            />
          </div>

          {/* Email Field */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label
                htmlFor="email"
                className="text-xs font-semibold text-muted-foreground uppercase tracking-wider"
              >
                Email Address
              </Label>
              {email && !emailError && (
                <span className="text-[10px] text-green-600 flex items-center gap-1 font-medium animate-in fade-in slide-in-from-left-2">
                  <CheckCircle2 className="h-3 w-3" /> Valid
                </span>
              )}
            </div>
            <Input
              id="email"
              name="email"
              required
              type="email"
              placeholder="john@company.com"
              className={cn(
                'h-10 text-sm bg-background/50 border-input transition-colors focus:bg-background',
                emailError && 'border-red-300 focus-visible:ring-red-200'
              )}
              maxLength={320}
              value={email}
              onChange={handleEmailChange}
            />
            {emailError && (
              <p className="text-xs text-red-500 font-medium flex items-center gap-1 mt-1 animate-in fade-in slide-in-from-top-1">
                <AlertCircle className="h-3 w-3" /> {emailError}
              </p>
            )}
          </div>

          {/* Role Field */}
          <div className="space-y-2">
            <Label
              htmlFor="role"
              className="text-xs font-semibold text-muted-foreground uppercase tracking-wider"
            >
              Role Permission
            </Label>
            <input type="hidden" name="role" value={selectedRole} />
            <Select value={selectedRole} onValueChange={setSelectedRole} disabled={disabled}>
              <SelectTrigger className="h-auto py-2.5 pl-3 pr-4 w-full bg-background/50 items-start">
                <div className="flex items-center gap-3 text-left">
                  {selectedRole === 'ADMIN' ? (
                    <div className="p-1 bg-purple-100 rounded-md text-purple-600">
                      <ShieldAlert className="h-4 w-4" />
                    </div>
                  ) : selectedRole === 'RESPONDER' ? (
                    <div className="p-1 bg-blue-100 rounded-md text-blue-600">
                      <Shield className="h-4 w-4" />
                    </div>
                  ) : (
                    <div className="p-1 bg-gray-100 rounded-md text-gray-600">
                      <Users className="h-4 w-4" />
                    </div>
                  )}
                  <div className="flex flex-col">
                    <span className="font-semibold text-sm">
                      {selectedRole.charAt(0) + selectedRole.slice(1).toLowerCase()}
                    </span>
                    <span className="text-[10px] text-muted-foreground line-clamp-1">
                      {ROLE_DESCRIPTIONS[selectedRole as keyof typeof ROLE_DESCRIPTIONS]}
                    </span>
                  </div>
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ADMIN" className="py-2.5">
                  <div className="flex items-center gap-3">
                    <div className="p-1 bg-purple-100 rounded-md text-purple-600">
                      <ShieldAlert className="h-4 w-4" />
                    </div>
                    <div className="flex flex-col">
                      <span className="font-medium text-sm">Admin</span>
                      <span className="text-[10px] text-muted-foreground">Full system control</span>
                    </div>
                  </div>
                </SelectItem>
                <SelectItem value="RESPONDER" className="py-2.5">
                  <div className="flex items-center gap-3">
                    <div className="p-1 bg-blue-100 rounded-md text-blue-600">
                      <Shield className="h-4 w-4" />
                    </div>
                    <div className="flex flex-col">
                      <span className="font-medium text-sm">Responder</span>
                      <span className="text-[10px] text-muted-foreground">Manage incidents</span>
                    </div>
                  </div>
                </SelectItem>
                <SelectItem value="AUDITOR" className="py-2.5">
                  <div className="flex items-center gap-3">
                    <div className="p-1 bg-amber-100 rounded-md text-amber-700">
                      <Shield className="h-4 w-4" />
                    </div>
                    <div className="flex flex-col">
                      <span className="font-medium text-sm">Auditor</span>
                      <span className="text-[10px] text-muted-foreground">
                        Organization-wide read access
                      </span>
                    </div>
                  </div>
                </SelectItem>
                <SelectItem value="USER" className="py-2.5">
                  <div className="flex items-center gap-3">
                    <div className="p-1 bg-gray-100 rounded-md text-gray-600">
                      <Users className="h-4 w-4" />
                    </div>
                    <div className="flex flex-col">
                      <span className="font-medium text-sm">User</span>
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
          <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm border border-red-100 flex items-start gap-2 animate-in fade-in slide-in-from-top-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <p>{getUserFriendlyError(state.error)}</p>
          </div>
        )}

        {state?.success && state?.inviteUrl && (
          <div className="bg-green-50 border border-green-100 rounded-xl p-4 space-y-3 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex items-center gap-2 text-green-700 font-semibold text-sm">
              <CheckCircle2 className="h-4 w-4" /> User Invited Successfully!
            </div>
            {state.emailSent && (
              <p className="text-[11px] text-green-700/80 leading-relaxed pl-6">
                Invitation email sent to the user.
              </p>
            )}

            <div className="bg-white border rounded-lg p-2 flex items-center gap-2 shadow-sm">
              <code className="text-xs flex-1 truncate font-mono bg-muted/30 p-1 rounded px-2 text-muted-foreground">
                {state.inviteUrl}
              </code>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={copyToClipboard}
                className={cn('h-7 w-7 p-0 shrink-0', isCopied && 'text-green-600 bg-green-50')}
              >
                {isCopied ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
            <p className="text-[11px] text-green-700/80 leading-relaxed pl-6">
              Share this link with them. They need it to set up their account password.
            </p>
          </div>
        )}
        {state?.success && !state?.inviteUrl && (
          <div className="bg-green-50 border border-green-100 rounded-lg p-3 flex items-center gap-2 text-sm text-green-700 animate-in fade-in slide-in-from-bottom-2">
            <CheckCircle2 className="h-4 w-4" /> Invitation sent via email!
          </div>
        )}
      </form>
    </div>
  );
}
