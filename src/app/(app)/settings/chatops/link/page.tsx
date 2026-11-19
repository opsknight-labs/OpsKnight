import { linkMicrosoftTeamsAccount } from './actions';
import { requirePageAccess } from '@/lib/access/server';
import { describeMicrosoftTeamsIdentityChallenge } from '@/lib/microsoft-teams/identity';

export default async function LinkChatOpsPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  await requirePageAccess('/settings/chatops/link');
  const { token = '' } = await searchParams;
  const pending = await describeMicrosoftTeamsIdentityChallenge(token);
  return (
    <main className="mx-auto max-w-xl space-y-6 p-8">
      <h1 className="font-display text-2xl font-semibold">Link Microsoft Teams</h1>
      {pending ? (
        <>
          <p className="text-sm text-muted-foreground">
            This link will let the Microsoft Teams account below act as your signed-in OpsKnight
            user in Teams.
          </p>
          <dl className="rounded-md border p-4 text-sm">
            <dt className="text-muted-foreground">Teams account</dt>
            <dd className="font-medium">{pending.displayName || 'Unknown Teams user'}</dd>
            <dt className="mt-2 text-muted-foreground">Tenant</dt>
            <dd className="font-mono text-xs">{pending.tenantId}</dd>
          </dl>
          <p className="text-sm font-medium text-destructive">
            Only continue if this is your own Teams account and you opened this link yourself from
            Teams. Never complete a link someone else sent you.
          </p>
          <form action={linkMicrosoftTeamsAccount}>
            <input type="hidden" name="token" value={token} />
            <button
              type="submit"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Link this Teams account
            </button>
          </form>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          This Microsoft Teams account-link request is invalid or expired. Start a new link from
          Teams.
        </p>
      )}
    </main>
  );
}
