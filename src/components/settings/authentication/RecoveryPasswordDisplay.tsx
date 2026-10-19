'use client';
import { copyAuthenticationText } from './clipboard';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/shadcn/dialog';
import { Button } from '@/components/ui/shadcn/button';
import { useAuthenticationWorkspace } from './useAuthenticationController';
export default function RecoveryPasswordDisplay() {
  const { data, generatedRecovery, setGeneratedRecovery } = useAuthenticationWorkspace();
  const [stored, setStored] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  return (
    <Dialog open={Boolean(generatedRecovery)} onOpenChange={() => undefined}>
      <DialogContent
        onEscapeKeyDown={event => event.preventDefault()}
        onPointerDownOutside={event => event.preventDefault()}
        className="[&>button:last-child]:hidden"
      >
        <DialogTitle>Store your one-time recovery password</DialogTitle>
        <DialogDescription>
          This password is displayed once. Save it in a vault accessible independently of your
          identity provider before acknowledging.
        </DialogDescription>
        <p className="break-all text-sm">Account: {generatedRecovery?.id}</p>
        <code className="break-all select-all rounded-md bg-muted p-3">
          {generatedRecovery?.password}
        </code>
        <Button
          variant="outline"
          onClick={() =>
            void copyAuthenticationText(generatedRecovery?.password ?? '').then(copied =>
              setCopyStatus(
                copied
                  ? 'Password copied. Clear the clipboard after storing it.'
                  : 'Clipboard unavailable. Select the password and copy it manually.'
              )
            )
          }
        >
          Copy password
        </Button>
        <p role="status" className="text-sm">
          {copyStatus}
        </p>
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={stored}
            onChange={event => setStored(event.target.checked)}
          />
          I stored this password in an independently accessible vault.
        </label>
        <Button
          disabled={!stored}
          onClick={() => {
            const self = data.actor.kind === 'emergency' && data.actor.id === generatedRecovery?.id;
            setGeneratedRecovery(null);
            if (self) {
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Store the replacement before replacing the revoked document.
              window.location.assign('/login/emergency');
            }
          }}
        >
          Acknowledge and close
        </Button>
      </DialogContent>
    </Dialog>
  );
}
