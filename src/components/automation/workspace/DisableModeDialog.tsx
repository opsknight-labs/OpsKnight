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

/**
 * Confirms leaving the current mode: turning automation off for a SHADOW or LIVE service, or
 * stepping a LIVE service down to SHADOW, which stops it applying routing to new incidents.
 */
export function DisableModeDialog({
  open,
  currentMode,
  targetMode = 'DISABLED',
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  currentMode: string;
  targetMode?: 'DISABLED' | 'SHADOW';
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const toShadow = targetMode === 'SHADOW';
  return (
    <AlertDialog open={open} onOpenChange={next => !next && !busy && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {toShadow
              ? 'Switch this service to shadow mode?'
              : 'Turn off automation for this service?'}
          </AlertDialogTitle>
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
          {toShadow && (
            <li>Automation keeps comparing its routing against the default in SHADOW.</li>
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
            {toShadow
              ? busy
                ? 'Switching…'
                : 'Switch to SHADOW'
              : busy
                ? 'Turning off…'
                : 'Turn off automation'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
