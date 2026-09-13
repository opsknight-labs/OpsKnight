import { linkMicrosoftTeamsAccount } from './actions';

export default async function LinkChatOpsPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = '' } = await searchParams;
  return (
    <main className="mx-auto max-w-xl space-y-6 p-8">
      <h1 className="font-display text-2xl font-semibold">Link Microsoft Teams</h1>
      <p className="text-sm text-muted-foreground">Confirm that the Microsoft Teams account which opened this link belongs to your signed-in OpsKnight user.</p>
      <form action={linkMicrosoftTeamsAccount}>
        <input type="hidden" name="token" value={token} />
        <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Link account</button>
      </form>
    </main>
  );
}
