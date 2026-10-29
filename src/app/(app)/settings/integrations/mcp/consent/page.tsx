import { assertCanReviewMcpConsent } from '@/lib/mcp/auth/consent';
import { requireMcp } from '@/lib/mcp/core/errors';
import { decideMcpConsent } from '../actions';

export const dynamic = 'force-dynamic';
export default async function McpConsent({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  requireMcp(id && /^[A-Za-z0-9_-]{1,128}$/.test(id), 'MCP_CONSENT_EXPIRED');
  const { request, client } = await assertCanReviewMcpConsent(id);
  return (
    <div className="max-w-xl rounded-lg border p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Allow {client.name} to access OpsKnight?</h1>
      <p>
        This client will act with your current role and resource access. You can revoke access in
        MCP settings at any time.
      </p>
      {client.dynamicRegistration && (
        <p role="note" className="rounded border border-amber-500/40 bg-amber-500/10 p-3">
          This application registered automatically. Its name is supplied by the application, not
          verified by OpsKnight. Check the return address and requested access before allowing it.
        </p>
      )}
      <p className="break-all">
        Client ID: <code>{client.id}</code>
      </p>
      <p className="break-all">Return address: {request.redirectUri}</p>
      <h2 className="font-semibold">Requested scopes</h2>
      <ul className="list-disc pl-6">
        {request.scopes.map(scope => (
          <li key={scope}>{scope}</li>
        ))}
      </ul>
      <form action={decideMcpConsent} className="flex flex-wrap gap-4">
        <input type="hidden" name="id" value={request.id} />
        <button name="decision" value="deny" className="rounded border px-4 py-3" type="submit">
          Deny
        </button>
        <button
          name="decision"
          value="allow"
          className="rounded bg-primary text-primary-foreground px-4 py-3"
          type="submit"
        >
          Allow requested scopes
        </button>
      </form>
    </div>
  );
}
