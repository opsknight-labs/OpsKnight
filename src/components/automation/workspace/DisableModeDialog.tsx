'use client';
import { PowerOff } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/shadcn/alert-dialog';
import { Button } from '@/components/ui/shadcn/button';

/** Confirms turning automation off for a service that is currently SHADOW or LIVE. */
export function DisableModeDialog({
  open,
  currentMode,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  currentMode: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={next => !next && !busy && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Turn off automation for this service?</AlertDialogTitle>
          <AlertDialogDescription>
            The service leaves {currentMode} mode immediately.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {currentMode === 'LIVE' ? (
            <li>New incidents stop using automation routing and use the service default.</li>
          ) : (
            <li>Shadow comparisons stop for new alerts.</li>
          )}
          <li>Existing incidents keep their pinned routing decisions.</li>
          <li>The draft and every published version are kept; you can re-enable at any time.</li>
        </ul>
        <AlertDialogFooter className="gap-2 sm:space-x-0">
          <AlertDialogCancel className="mt-0" disabled={busy}>
            Keep {currentMode}
          </AlertDialogCancel>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>
            <PowerOff aria-hidden="true" />
            {busy ? 'Turning off…' : 'Turn off automation'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
