import Link from 'next/link';
import prisma from '@/lib/prisma';
import { getUserPermissions } from '@/lib/rbac';
import { mcpResource } from '@/lib/mcp/auth/config';
import { requireMcp } from '@/lib/mcp/core/errors';
import { registerMcpClient, revokeMcpAccess, updateMcpPolicy } from './actions';

export const dynamic = 'force-dynamic';
const inputClass = 'rounded border border-border bg-background px-3 py-2 w-full';

export default async function McpSettings({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string; q?: string }>;
}) {
  const permissions = await getUserPermissions();
  requireMcp(permissions.authenticated, 'MCP_LOGIN_REQUIRED', 401);
  const { cursor, q = '' } = await searchParams;
  requireMcp(!cursor || /^[A-Za-z0-9_-]{1,128}$/.test(cursor), 'MCP_INVALID_CURSOR');
  requireMcp(q.length <= 100, 'MCP_INVALID_SEARCH');
  const [policy, clients, grants] = await Promise.all([
    prisma.mcpPolicy.findUnique({ where: { id: 'default' } }),
    permissions.isAdmin
      ? prisma.mcpClient.findMany({
          where: { name: { contains: q, mode: 'insensitive' } },
          take: 50,
          orderBy: { id: 'asc' },
          select: { id: true, name: true, revokedAt: true, scopes: true },
        })
      : Promise.resolve([]),
    prisma.mcpGrant.findMany({
      where: {
        ...(permissions.isAdmin ? {} : { userId: permissions.id }),
        client: { name: { contains: q, mode: 'insensitive' } },
      },
      take: 26,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        userId: true,
        scopes: true,
        revokedAt: true,
        expiresAt: true,
        client: { select: { name: true } },
      },
    }),
  ]);
  return (
    <div className="space-y-6 max-w-4xl">
      <header>
        <h1 className="text-2xl font-semibold">MCP integration</h1>
        <p className="text-muted-foreground">
          Connect external assistants with explicit consent and current OpsKnight permissions.
        </p>
      </header>
      <form className="flex gap-2" method="get">
        <label className="grow">
          Search clients and grants
          <input className={inputClass} name="q" maxLength={100} defaultValue={q} />
        </label>
        <button className="self-end rounded border px-4 py-2" type="submit">
          Search
        </button>
      </form>
      <section className="rounded-lg border p-4 space-y-2" aria-label="Connection status">
        <p>
          <strong>Status:</strong> {policy?.enabled ? 'Enabled' : 'Disabled'}
        </p>
        <p className="break-all">
          <strong>Remote endpoint:</strong> <code>{mcpResource()}</code>
        </p>
        <p>
          Protocol: 2026-07-28. Register a client, use authorization code with PKCE S256, then
          approve its scopes while signed in. Credentials belong only in the client’s secure
          credential store.
        </p>
        <p>
          Client interoperability, sensitive approvals, durable Tasks and MCP Apps are awaiting
          certification. No external host compatibility is claimed.
        </p>
      </section>
      {permissions.isAdmin && (
        <>
          <form action={updateMcpPolicy} className="rounded-lg border p-4 space-y-4">
            <h2 className="text-lg font-semibold">Access and workload policy</h2>
            <label className="flex gap-2">
              <input type="checkbox" name="enabled" defaultChecked={policy?.enabled ?? false} />
              Enable MCP (uncheck for emergency MCP-only shutdown)
            </label>
            <label className="flex gap-2">
              <input
                type="checkbox"
                name="writesEnabled"
                defaultChecked={policy?.writesEnabled ?? false}
              />
              Allow reviewed routine mutations and approved runbook executions
            </label>
            <div className="grid sm:grid-cols-3 gap-4">
              <label>
                Concurrent requests per process
                <input
                  className={inputClass}
                  name="maxInFlight"
                  type="number"
                  min="1"
                  max="16"
                  defaultValue={policy?.maxInFlight ?? 4}
                  required
                />
              </label>
              <label>
                Operations per request
                <input
                  className={inputClass}
                  name="maxOperations"
                  type="number"
                  min="1"
                  max="16"
                  defaultValue={policy?.maxOperations ?? 8}
                  required
                />
              </label>
              <label>
                Weighted operations per minute per grant
                <input
                  className={inputClass}
                  name="requestsPerMinute"
                  type="number"
                  min="1"
                  max="600"
                  defaultValue={policy?.requestsPerMinute ?? 60}
                  required
                />
              </label>
            </div>
            <button className="rounded bg-primary text-primary-foreground px-4 py-2" type="submit">
              Save policy
            </button>
          </form>
          <form action={registerMcpClient} className="rounded-lg border p-4 space-y-3">
            <h2 className="text-lg font-semibold">Register a client</h2>
            <label className="block">
              Display name
              <input className={inputClass} name="name" required maxLength={100} />
            </label>
            <label className="block">
              Exact redirect URI
              <input
                className={inputClass}
                name="redirectUri"
                type="url"
                required
                placeholder="http://127.0.0.1:8765/callback"
              />
            </label>
            <label className="block">
              Allowed scopes (space separated)
              <input
                className={inputClass}
                name="scopes"
                required
                placeholder="incidents:read services:read schedules:read"
              />
            </label>
            <button className="rounded bg-primary text-primary-foreground px-4 py-2" type="submit">
              Register client
            </button>
          </form>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Clients</h2>
            {clients.length === 0 && <p>No clients registered.</p>}
            {clients.map(client => (
              <article key={client.id} className="rounded border p-3 space-y-1">
                <h3 className="font-medium">{client.name}</h3>
                <p className="break-all">
                  Client ID: <code>{client.id}</code>
                </p>
                <p>{client.scopes.join(', ')}</p>
                {client.revokedAt ? (
                  <p>Revoked</p>
                ) : (
                  <form action={revokeMcpAccess}>
                    <input type="hidden" name="kind" value="client" />
                    <input type="hidden" name="id" value={client.id} />
                    <button className="underline py-2" type="submit">
                      Revoke client and all its grants
                    </button>
                  </form>
                )}
              </article>
            ))}
          </section>
        </>
      )}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          {permissions.isAdmin ? 'Client grants' : 'Your grants'}
        </h2>
        {grants.length === 0 && <p>No grants.</p>}
        {grants.slice(0, 25).map(grant => (
          <article key={grant.id} className="rounded border p-3">
            <h3 className="font-medium">{grant.client.name}</h3>
            <p className="break-all">Principal ID: {grant.userId}</p>
            <p>{grant.scopes.join(', ')}</p>
            <p>Expires {grant.expiresAt.toISOString()}</p>
            {grant.revokedAt ? (
              <p>Revoked</p>
            ) : (
              <form action={revokeMcpAccess}>
                <input type="hidden" name="kind" value="grant" />
                <input type="hidden" name="id" value={grant.id} />
                <button className="underline py-2" type="submit">
                  Revoke grant
                </button>
              </form>
            )}
          </article>
        ))}
        {grants.length > 25 && (
          <Link className="underline" href={`?cursor=${grants[24].id}&q=${encodeURIComponent(q)}`}>
            Next grants
          </Link>
        )}
      </section>
    </div>
  );
}
