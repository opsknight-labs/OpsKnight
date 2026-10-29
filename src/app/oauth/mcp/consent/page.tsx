import Image from 'next/image';
import { redirect } from 'next/navigation';
import { AppError } from '@/lib/errors';
import { getCurrentUser } from '@/lib/rbac';
import { assertCanReviewMcpConsent, expiredConsentReturn } from '@/lib/mcp/auth/consent';
import { McpBoundaryError } from '@/lib/mcp/core/errors';
import { describeMcpScope } from '@/lib/mcp/auth/scopes';
import { decideMcpConsent } from '@/app/(app)/settings/integrations/mcp/actions';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Connect assistant | OpsKnight',
  referrer: 'no-referrer' as const,
};

export default async function McpConsent({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  if (!id || !/^[A-Za-z0-9_-]{1,128}$/.test(id))
    redirect('/oauth/mcp/consent/result?code=MCP_CONSENT_EXPIRED');
  let review;
  let who;
  try {
    review = await assertCanReviewMcpConsent(id);
    who = await getCurrentUser();
  } catch (error) {
    if (
      error instanceof AppError &&
      ['AUTHENTICATION_REQUIRED', 'SESSION_REVOKED'].includes(error.code)
    )
      redirect(`/login?callbackUrl=${encodeURIComponent(`/oauth/mcp/consent?id=${id}`)}`);
    const code = error instanceof McpBoundaryError ? error.code : 'MCP_UNAVAILABLE';
    if (code === 'MCP_CONSENT_EXPIRED') {
      // Send the person back to their assistant so it can offer a retry, instead of a dead end.
      const back = await expiredConsentReturn(id);
      if (back) redirect(back);
    }
    redirect(`/oauth/mcp/consent/result?code=${encodeURIComponent(code)}`);
  }
  const { request, client } = review;
  let host = '';
  try {
    host = new URL(request.redirectUri).host;
  } catch {}
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-10">
      <a
        href="https://opsknight.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2"
      >
        <Image
          src="/logo.png"
          alt=""
          width={32}
          height={32}
          className="h-8 w-8 object-contain"
          priority
          unoptimized
        />
        <span className="text-lg font-semibold">OpsKnight</span>
      </a>
      <section className="space-y-5 rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="space-y-1">
          <h1
            className="break-words font-semibold"
            // The global h1 style is a large display size; this is a compact dialog title.
            style={{ fontSize: '1.25rem', lineHeight: 1.35 }}
          >
            Connect {client.name}?
          </h1>
          <p className="text-sm text-muted-foreground">
            Signed in as <strong>{who.email ?? who.name ?? 'you'}</strong>. This assistant will act
            as you, with your current permissions.
          </p>
        </div>
        <div className="space-y-2">
          <h2 className="text-sm font-medium">It will be able to</h2>
          <ul className="space-y-1.5 text-sm">
            {request.scopes.map(scope => (
              <li key={scope} className="flex gap-2">
                <span aria-hidden="true">✓</span>
                <span>{describeMcpScope(scope)}</span>
              </li>
            ))}
          </ul>
        </div>
        <form action={decideMcpConsent} className="flex gap-3">
          <input type="hidden" name="id" value={request.id} />
          <button
            name="decision"
            value="deny"
            type="submit"
            className="flex-1 rounded-md border border-border px-4 py-2.5 text-sm font-medium"
          >
            Cancel
          </button>
          <button
            name="decision"
            value="allow"
            type="submit"
            className="flex-1 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground"
          >
            Allow
          </button>
        </form>
        <p className="text-xs text-muted-foreground">
          You can disconnect any time in Settings → Integrations & ChatOps → MCP (AI Assistants).
          {client.dynamicRegistration && (
            <>
              {' '}
              Only continue if you just started this connection yourself
              {host ? <> (it will return to {host})</> : null}.
            </>
          )}
        </p>
      </section>
    </main>
  );
}
