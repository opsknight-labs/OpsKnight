'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/shadcn/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/shadcn/alert-dialog';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { notify as toast } from '@/lib/toast';

export default function ConnectedChatOpsAccounts({
  links,
}: {
  links: Array<{
    id: string;
    provider: string;
    providerTenantId: string;
    displayName: string | null;
  }>;
}) {
  const router = useRouter();
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  if (!links || links.length === 0) return null;

  const unlink = async (id: string) => {
    setDisconnectingId(id);
    try {
      const response = await fetch('/api/settings/chatops/identities', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) {
        toast.error('Could not disconnect this ChatOps account.');
        return;
      }
      toast.success('ChatOps account disconnected.');
      router.refresh();
    } catch {
      toast.error('A network error occurred. Please try again.');
    } finally {
      setDisconnectingId(null);
    }
  };

  return (
    <SettingsSection
      title="Connected ChatOps Accounts"
      description="Accounts explicitly linked to your OpsKnight identity"
    >
      <div className="space-y-3">
        {links.map(link => (
          <div key={link.id} className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">
                {link.provider === 'MICROSOFT_TEAMS' ? 'Microsoft Teams' : 'Slack'} ·{' '}
                {link.displayName ?? 'Linked account'}
              </div>
              <div className="text-xs text-muted-foreground">Tenant {link.providerTenantId}</div>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disconnectingId === link.id}
                >
                  {disconnectingId === link.id ? 'Disconnecting…' : 'Disconnect'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Disconnect ChatOps account?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will remove the link between your OpsKnight identity and your{' '}
                    {link.provider === 'MICROSOFT_TEAMS' ? 'Microsoft Teams' : 'Slack'} account
                    ({link.displayName ?? link.providerTenantId}). You can reconnect at any time.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => unlink(link.id)}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Disconnect
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ))}
      </div>
    </SettingsSection>
  );
}
