'use client';

import { useActionState } from 'react';

type ActionState = {
  error?: string | null;
  success?: boolean;
  inviteUrl?: string | null;
  emailSent?: boolean;
};

type Props = {
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  className?: string;
};

export default function InviteLinkButton({ action, className = '' }: Props) {
  const [state, formAction] = useActionState(action, { error: null, success: false });

  return (
    <form action={formAction} className={`invite-link-form ${className}`.trim()}>
      <button type="submit" className="glass-button invite-link-button">
        Generate invite link
      </button>
      {state?.inviteUrl ? (
        <div className="invite-link-feedback">
          <input value={state.inviteUrl} readOnly className="invite-link-input" />
          <button
            type="button"
            className="glass-button invite-link-button"
            onClick={() => navigator.clipboard.writeText(state.inviteUrl || '')}
          >
            Copy link
          </button>
          {state.emailSent ? <span className="invite-link-note">Email sent</span> : null}
        </div>
      ) : null}
      {state?.error ? <div className="invite-link-error">{state.error}</div> : null}
    </form>
  );
}
