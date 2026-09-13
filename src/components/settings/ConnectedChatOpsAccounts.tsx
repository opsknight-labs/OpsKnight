'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/shadcn/button';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { notify as toast } from '@/lib/toast';

export default function ConnectedChatOpsAccounts({ links }: { links: Array<{ id: string; provider: string; providerTenantId: string; displayName: string | null }> }) {
  const router = useRouter();
  const unlink = async (id: string) => {
    const response = await fetch('/api/settings/chatops/identities', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    if (!response.ok) return toast.error('Could not disconnect this ChatOps account.');
    toast.success('ChatOps account disconnected.');
    router.refresh();
  };
  return (
    <SettingsSection title="Connected ChatOps Accounts" description="Accounts explicitly linked to your OpsKnight identity">
      {links.length === 0 ? <p className="text-sm text-muted-foreground">No ChatOps accounts are connected.</p> : links.map(link => (
        <div key={link.id} className="flex items-center justify-between rounded-lg border p-3">
          <div><div className="text-sm font-medium">{link.provider === 'MICROSOFT_TEAMS' ? 'Microsoft Teams' : 'Slack'} · {link.displayName ?? 'Linked account'}</div><div className="text-xs text-muted-foreground">Tenant {link.providerTenantId}</div></div>
          <Button type="button" variant="outline" size="sm" onClick={() => unlink(link.id)}>Disconnect</Button>
        </div>
      ))}
    </SettingsSection>
  );
}
