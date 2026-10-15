'use client';

import { useActionState } from 'react';

/**
 * `useActionState` that never keeps a one-time secret in React's action state.
 *
 * A server action that issues a credential returns it once in `token`. React would hold that
 * result as the component's action state until unmount. This wrapper hands the secret to
 * `onSecret` (short-lived component state that the dismissal flow clears) and returns the result
 * with `token` removed, so no second copy remains in the action state.
 */
export function useSecretSafeAction<S extends { token?: string | null }>(
  action: (previous: S, formData: FormData) => Promise<S>,
  initial: S,
  onSecret: (token: string) => void,
  /** Called with every result (secret already removed), e.g. to close a dialog on success. */
  onResult?: (result: S) => void
) {
  // React types the state as Awaited<S>; S is a plain object here, so the casts are identity.
  const wrapped = async (previous: Awaited<S>, formData: FormData): Promise<Awaited<S>> => {
    const next = await action(previous as unknown as S, formData);
    if (next?.token) {
      onSecret(next.token);
      const stripped = { ...next, token: null } as S;
      onResult?.(stripped);
      return stripped as unknown as Awaited<S>;
    }
    onResult?.(next);
    return next as unknown as Awaited<S>;
  };
  return useActionState(wrapped, initial as unknown as Awaited<S>);
}
