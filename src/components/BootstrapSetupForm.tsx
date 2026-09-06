'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { bootstrapAdmin } from '@/app/setup/actions';
import { Mail, User, CheckCircle2, AlertCircle, Copy, Check, Shield } from 'lucide-react';
import { useState } from 'react';

type FormState = {
  error?: string | null;
  success?: boolean;
  password?: string | null;
  email?: string | null;
};

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-white py-4 text-sm font-bold text-black uppercase tracking-wider transition-all duration-300 hover:bg-white/90 hover:shadow-[0_0_30px_rgba(255,255,255,0.3)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
    >
      {pending ? (
        <>
          <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span>Creating Admin...</span>
        </>
      ) : (
        <>
          <span>Generate Admin Credentials</span>
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M14 5l7 7m0 0l-7 7m7-7H3"
            />
          </svg>
        </>
      )}
    </button>
  );
}

function CopyableField({
  label,
  value,
  isPassword = false,
}: {
  label: string;
  value: string;
  isPassword?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-white/50">{label}</p>
      <div
        onClick={handleCopy}
        className="group flex items-center gap-3 p-3 rounded-lg bg-black/50 border border-white/10 cursor-pointer hover:border-white/20 hover:bg-black/60 transition-all"
      >
        <code
          className={`flex-1 text-sm font-mono ${isPassword ? 'text-emerald-400' : 'text-white'} select-all overflow-x-auto whitespace-nowrap scrollbar-hide`}
        >
          {value}
        </code>
        <button className="shrink-0 p-1.5 rounded bg-white/5 group-hover:bg-white/10 transition-colors">
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-400" />
          ) : (
            <Copy className="h-3.5 w-3.5 text-white/40 group-hover:text-white/60" />
          )}
        </button>
      </div>
    </div>
  );
}

export default function BootstrapSetupForm() {
  const [state, formAction] = useActionState<FormState, FormData>(
    async (_prevState, formData) => {
      return bootstrapAdmin(formData);
    },
    {
      error: null,
      success: false,
    }
  );

  // Success state - compact design
  if (state?.success && state.password && state.email) {
    return (
      <div className="space-y-5">
        {/* Success Header */}
        <div className="flex items-center gap-4 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/20">
            <CheckCircle2 className="h-6 w-6 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Setup Complete</h3>
            <p className="text-sm text-white/60">Your admin account is ready</p>
          </div>
        </div>

        {/* Instructions */}
        <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <Shield className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
          <p className="text-xs text-white/70 leading-relaxed">
            <span className="font-semibold text-amber-300">Save these credentials now.</span> The
            password won&apos;t be shown again. Click any field to copy.
          </p>
        </div>

        {/* Credentials */}
        <div className="space-y-3">
          <CopyableField label="Email" value={state.email} />
          <CopyableField label="Temporary Password" value={state.password} isPassword />
        </div>

        {/* Back to Sign In */}
        <a
          href="/login"
          className="block w-full rounded-xl bg-emerald-500 py-3.5 text-sm font-bold text-white uppercase tracking-wider text-center transition-all duration-300 hover:bg-emerald-400 hover:shadow-[0_0_20px_rgba(16,185,129,0.3)]"
        >
          Back to Sign In →
        </a>
      </div>
    );
  }

  // Form view
  return (
    <form action={formAction} className="space-y-5">
      {/* Full Name Field */}
      <div className="space-y-2">
        <label className="text-xs font-bold uppercase tracking-wider text-white/60">
          Full Name
        </label>
        <div className="relative flex items-center rounded-xl border border-white/10 bg-white/5 transition-colors focus-within:border-white/30 focus-within:bg-white/10">
          <div className="flex items-center justify-center pl-4 pr-3 py-4 border-r border-white/10">
            <User className="h-5 w-5 text-white/40" />
          </div>
          <input
            name="name"
            type="text"
            required
            className="flex-1 bg-transparent px-4 py-4 text-white placeholder:text-white/30 focus:outline-none"
            placeholder="Alice DevOps"
          />
        </div>
      </div>

      {/* Email Field */}
      <div className="space-y-2">
        <label className="text-xs font-bold uppercase tracking-wider text-white/60">
          Email Address
        </label>
        <div className="relative flex items-center rounded-xl border border-white/10 bg-white/5 transition-colors focus-within:border-white/30 focus-within:bg-white/10">
          <div className="flex items-center justify-center pl-4 pr-3 py-4 border-r border-white/10">
            <Mail className="h-5 w-5 text-white/40" />
          </div>
          <input
            name="email"
            type="email"
            required
            className="flex-1 bg-transparent px-4 py-4 text-white placeholder:text-white/30 focus:outline-none"
            placeholder="alice@opsknight.com"
          />
        </div>
      </div>

      <SubmitButton />

      {/* Error Display */}
      {state?.error && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20">
          <AlertCircle className="h-5 w-5 shrink-0 text-rose-400 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-rose-300">Setup Failed</p>
            <p className="text-xs text-white/60 mt-1">{state.error}</p>
          </div>
        </div>
      )}
    </form>
  );
}
