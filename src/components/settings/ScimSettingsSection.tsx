'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  scimOverviewAction,
  scimDirectoryAction,
  saveScimConnectorAction,
  createScimCredentialAction,
  revokeScimCredentialAction,
  previewScimBindingAction,
  approveScimBindingAction,
  detachScimBindingAction,
  restoreScimIdentityAction,
  scimTeamsAction,
  bindExistingScimUserAction,
  scimDriftAction,
} from '@/app/(app)/settings/system/scim-actions';

export type ScimConfigProps = {
  enabled: boolean;
  hasSecretToken: boolean;
  tokenHint: string | null;
  source: 'DATABASE' | 'ENV' | 'NONE';
  createdAt: string | null;
  updatedAt: string | null;
};
type Connector = Data<ReturnType<typeof scimOverviewAction>>[number];
type Directory = Data<ReturnType<typeof scimDirectoryAction>>;
type Impact = Data<ReturnType<typeof previewScimBindingAction>>;
type Data<T> = Exclude<Awaited<T>, { scimError: string }>;
async function result<T>(pending: Promise<T>): Promise<Data<T>> {
  const value = await pending;
  if (value && typeof value === 'object' && 'scimError' in value)
    throw new Error(String(value.scimError));
  return value as Data<T>;
}
const fieldClass = 'w-full rounded-md border bg-background px-3 py-2 text-sm';
const tabs = [
  'Overview',
  'Connections',
  'Users & Groups',
  'Activity',
  'Security',
  'Diagnostics',
] as const;

export default function ScimSettingsSection({
  initialConfig,
  tenantUrl,
}: {
  initialConfig: ScimConfigProps;
  tenantUrl: string;
}) {
  const [tab, setTab] = useState<(typeof tabs)[number]>('Overview');
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [selected, setSelected] = useState('legacy');
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [observedAt, setObservedAt] = useState(0);
  const [error, setError] = useState('');
  const [drift, setDrift] = useState<Data<ReturnType<typeof scimDriftAction>>>([]);
  const [notice, setNotice] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [directory, setDirectory] = useState<Directory>({ total: 0, rows: [] });
  const [kind, setKind] = useState<'users' | 'groups'>('users');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [groupId, setGroupId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [teamQuery, setTeamQuery] = useState('');
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([]);
  const [impact, setImpact] = useState<Impact | null>(null);
  const connector = connectors.find(c => c.id === selected);
  useEffect(() => {
    let current = true;
    result(scimOverviewAction())
      .then(data => {
        if (current) {
          setConnectors(data);
          setObservedAt(Date.now());
        }
      })
      .catch(e => {
        if (current) setError(e instanceof Error ? e.message : 'Cannot load connections.');
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [reload]);
  useEffect(() => {
    if (tab !== 'Users & Groups' && tab !== 'Activity') return;
    let current = true;
    const timer = setTimeout(() => {
      setLoading(true);
      return result(
        scimDirectoryAction({
          connectorId: selected,
          tab: tab === 'Activity' ? 'activity' : kind,
          query,
          page,
        })
      )
        .then(data => {
          if (current) setDirectory(data);
        })
        .catch(e => {
          if (current) setError(e instanceof Error ? e.message : 'Cannot load directory.');
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [selected, tab, kind, query, page, reload]);
  useEffect(() => {
    if (!groupId) return;
    let current = true;
    const timer = setTimeout(
      () =>
        result(scimTeamsAction(teamQuery))
          .then(data => {
            if (current) setTeams(data);
          })
          .catch(() => {
            if (current) setError('Cannot search operational teams.');
          }),
      250
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [groupId, teamQuery]);
  useEffect(() => {
    if (!secret) return;
    const timer = setTimeout(() => setSecret(null), 300000);
    return () => clearTimeout(timer);
  }, [secret]);
  async function run(operation: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
      setNotice(message);
      setReload(v => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation failed. Try again.');
    } finally {
      setBusy(false);
    }
  }
  const date = (value: string | null) => (value ? new Date(value).toLocaleString() : 'Never');
  return (
    <section aria-label="SCIM Provisioning" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">SCIM Provisioning</h3>
          <p className="text-sm text-muted-foreground">Identity lifecycle management</p>
        </div>
        <Badge variant="outline">{connector?.enabled ? 'Enabled' : 'Disconnected'}</Badge>
      </div>
      <nav aria-label="SCIM sections" className="flex flex-wrap gap-2">
        {tabs.map(item => (
          <Button
            key={item}
            type="button"
            size="sm"
            variant={tab === item ? 'default' : 'outline'}
            aria-current={tab === item ? 'page' : undefined}
            onClick={() => {
              setTab(item);
              setPage(1);
              setQuery('');
            }}
          >
            {item}
          </Button>
        ))}
      </nav>
      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">
          {notice}
        </p>
      )}
      <label className="block text-sm">
        Connection
        <select
          aria-label="SCIM connection"
          className={fieldClass}
          value={selected}
          onChange={e => {
            setSelected(e.target.value);
            setPage(1);
            setSecret(null);
            setGroupId('');
          }}
        >
          {connectors.map(c => (
            <option value={c.id} key={c.id}>
              {c.name} ({c.provider})
            </option>
          ))}
        </select>
      </label>
      {loading && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading provisioning data…
        </p>
      )}
      {tab === 'Overview' && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ['Managed identities', connector?._count.identities ?? 0],
              ['Directory groups', connector?._count.groups ?? 0],
              ['Credential authority', connector?.credentialAuthority ?? 'Unavailable'],
            ].map(([label, value]) => (
              <div className="rounded-lg border p-4" key={label}>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 text-xl font-semibold">{value}</p>
              </div>
            ))}
          </div>
          <label className="block text-sm">
            Provider base URL
            <input
              readOnly
              className={fieldClass}
              value={tenantUrl}
              onFocus={e => e.target.select()}
            />
          </label>
          <p className="text-sm text-muted-foreground">
            Authentication success does not verify provisioning. Create a disposable user, update
            it, disable it, and inspect Activity before enabling production assignments.
          </p>
          <p className="text-sm text-muted-foreground">
            Directory groups are separate from operational teams. Existing-team synchronization
            requires an administrator impact preview and approval. Directory deletion revokes its
            directory-owned team access while preserving manual grants, owners and routing.
          </p>
          {initialConfig.source === 'ENV' && connector?.credentialAuthority === 'LEGACY' && (
            <p className="text-sm text-amber-700 dark:text-amber-300">
              Legacy environment authentication is active. Create a replacement credential,
              configure the provider, then verify provisioning. Switching to registry credentials
              retires the environment token immediately.
            </p>
          )}
        </div>
      )}
      {tab === 'Connections' && (
        <div className="space-y-5">
          <p className="text-sm text-muted-foreground">
            Each provider has isolated users, groups and credentials. Disconnecting a connection
            blocks provisioning; it does not delete accounts or teams. Changes require administrator
            sign-in within the last two hours.
          </p>
          <form
            key={selected + reload}
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={e => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              void run(
                () =>
                  result(
                    saveScimConnectorAction({
                      ...(form.get('new') === 'on' ? {} : { id: selected }),
                      name: form.get('name'),
                      provider: form.get('provider'),
                      enabled: form.get('enabled') === 'on',
                      tenantId: form.get('tenantId') || null,
                      oidcIssuer: form.get('issuer') || null,
                      oidcClientId: form.get('client') || null,
                      trustedLinkEnabled: form.get('trusted') === 'on',
                      profileFields: form.getAll('profileField'),
                    })
                  ).then(result => setSelected(result.id)),
                'Connection saved.'
              );
            }}
          >
            <label className="text-sm">
              Connection name
              <input
                name="name"
                className={fieldClass}
                required
                maxLength={100}
                defaultValue={connector?.name}
              />
            </label>
            <label className="text-sm">
              Provider
              <select
                name="provider"
                aria-label="Provider"
                className={fieldClass}
                defaultValue={connector?.provider ?? 'GENERIC'}
              >
                <option value="ENTRA">Microsoft Entra</option>
                <option value="OKTA">Okta</option>
                <option value="GENERIC">Generic SCIM 2.0</option>
              </select>
            </label>
            <label className="text-sm">
              Entra tenant ID
              <input
                name="tenantId"
                className={fieldClass}
                defaultValue={connector?.tenantId ?? ''}
              />
            </label>
            <label className="text-sm">
              Registered OIDC issuer
              <input
                name="issuer"
                type="url"
                className={fieldClass}
                defaultValue={connector?.oidcIssuer ?? ''}
              />
            </label>
            <label className="text-sm">
              Registered OIDC client ID
              <input
                name="client"
                className={fieldClass}
                defaultValue={connector?.oidcClientId ?? ''}
              />
            </label>
            <div className="space-y-2 text-sm">
              <label className="flex gap-2">
                <input type="checkbox" name="enabled" defaultChecked={connector?.enabled ?? true} />
                Enable provisioning
              </label>
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  name="trusted"
                  defaultChecked={connector?.trustedLinkEnabled}
                />
                Trust immutable Entra object and tenant identity for first SSO linking
              </label>
              <label className="flex gap-2">
                <input type="checkbox" name="new" />
                Save as a new connection
              </label>
            </div>
            <fieldset className="space-y-2 text-sm sm:col-span-2">
              <legend>Profile attributes managed by this connection</legend>
              {['name', 'email', 'title', 'department', 'photos'].map(field => (
                <label key={field} className="mr-3 inline-flex gap-2">
                  <input
                    name="profileField"
                    type="checkbox"
                    value={field}
                    defaultChecked={connector?.profileFields.includes(field) ?? true}
                  />
                  {field}
                </label>
              ))}
            </fieldset>
            <Button type="submit" disabled={busy}>
              Save connection
            </Button>
          </form>
          <div className="rounded-lg border p-4 text-sm space-y-2">
            <h4 className="font-semibold">Provider setup</h4>
            <p>
              Entra: Enterprise applications → Provisioning → Automatic. Set Tenant URL and the
              one-time Secret Token. Map objectId → externalId and userPrincipalName → userName.
              Verify the work email equals userName.
            </p>
            <p>
              Okta: Configure SCIM Integration, use HTTP Header bearer authentication, userName as
              the lookup field, and map a stable directory identifier to externalId. Enable create,
              update and deactivate. Push Groups creates directory groups; bind teams after
              reviewing impact.
            </p>
            <p>
              Map displayName, name.givenName, name.familyName, active, title and the enterprise
              extension department as needed. Keep system roles in your explicit OIDC or manual role
              policy. Providers without immutable OIDC correspondence require existing-account
              linking approval.
            </p>
          </div>
        </div>
      )}
      {(tab === 'Users & Groups' || tab === 'Activity') && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3">
            {tab === 'Users & Groups' && (
              <label className="text-sm">
                Resource
                <select
                  className={fieldClass}
                  value={kind}
                  aria-label="Resource"
                  onChange={e => {
                    setKind(e.target.value as typeof kind);
                    setPage(1);
                  }}
                >
                  <option value="users">Users</option>
                  <option value="groups">Groups</option>
                </select>
              </label>
            )}
            <label className="grow text-sm">
              Search
              <input
                className={fieldClass}
                value={query}
                onChange={e => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
              />
            </label>
          </div>
          {!loading && directory.rows.length === 0 && (
            <p className="text-sm text-muted-foreground">No matching provisioning records.</p>
          )}
          <ul
            aria-label={tab === 'Activity' ? 'Provisioning activity' : 'Directory resources'}
            className="divide-y rounded-lg border"
          >
            {directory.rows.map(row => (
              <li key={row.id} className="p-3 space-y-1 break-words">
                <p className="font-medium text-sm">{row.label}</p>
                <p className="text-xs text-muted-foreground">{row.detail}</p>
                <p className="text-xs text-muted-foreground">{date(row.time)}</p>
                {tab === 'Users & Groups' && kind === 'groups' && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setGroupId(row.id);
                      setTeamId('');
                      setImpact(null);
                    }}
                  >
                    Review team binding
                  </Button>
                )}
                {tab === 'Users & Groups' &&
                  kind === 'users' &&
                  row.detail.startsWith('DELETED') && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => result(restoreScimIdentityAction({ id: row.id })),
                          'Restoration approved. The user remains disabled until the provider reactivates it.'
                        )
                      }
                    >
                      Approve rehire restoration
                    </Button>
                  )}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              disabled={loading || page === 1}
              onClick={() => setPage(p => p - 1)}
            >
              Previous
            </Button>
            <span className="text-sm">
              Page {page} · {directory.total} records
            </span>
            <Button
              variant="outline"
              disabled={loading || page * 25 >= directory.total}
              onClick={() => setPage(p => p + 1)}
            >
              Next
            </Button>
          </div>
          {groupId && tab === 'Users & Groups' && (
            <div className="rounded-lg border p-4 space-y-3">
              <h4 className="font-semibold">Provisioning impact preview</h4>
              <label className="block text-sm">
                Find an operational team
                <input
                  className={fieldClass}
                  value={teamQuery}
                  onChange={e => setTeamQuery(e.target.value)}
                />
              </label>
              <label className="block text-sm">
                Operational team
                <select
                  className={fieldClass}
                  value={teamId}
                  aria-label="Operational team"
                  onChange={e => {
                    setTeamId(e.target.value);
                    setImpact(null);
                  }}
                >
                  <option value="">Select team</option>
                  {teams.map(team => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                disabled={busy || !teamId}
                variant="outline"
                onClick={() =>
                  void run(
                    () => result(previewScimBindingAction({ groupId, teamId })).then(setImpact),
                    'Impact preview ready.'
                  )
                }
              >
                Preview binding
              </Button>
              {impact && (
                <div className="space-y-2 text-sm">
                  <p>
                    {impact.group} → {impact.team}
                  </p>
                  <p>
                    {impact.additions} members added; {impact.removals} existing memberships
                    removed; {impact.protectedOwners} owners protected.
                  </p>
                  <p>
                    {impact.services} services and {impact.escalations} escalation rules use this
                    team.
                  </p>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          result(
                            approveScimBindingAction({
                              groupId,
                              teamId,
                              revision: impact.revision,
                            })
                          ).then(() => setImpact(null)),
                        'Binding approved and memberships reconciled.'
                      )
                    }
                  >
                    Approve this impact
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Detaching revokes directory-owned memberships. Other approved groups, manual grants
                and owners remain.
              </p>
              <Button
                variant="outline"
                disabled={busy || !teamId}
                onClick={() =>
                  void run(
                    () => result(detachScimBindingAction({ groupId, teamId })),
                    'Binding detached. Directory-owned access revoked; manual access retained.'
                  )
                }
              >
                Detach binding
              </Button>
            </div>
          )}
        </div>
      )}
      {tab === 'Security' && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Create or revoke credentials after signing in as an administrator within the last two
            hours. New secrets are shown once and hidden after five minutes. Copy the secret to the
            provider before closing this view.
          </p>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={e => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              void run(
                () =>
                  result(
                    createScimCredentialAction({
                      connectorId: selected,
                      name: form.get('name'),
                      scopes: form.getAll('scope'),
                      lifetimeDays: Number(form.get('days')),
                      overlapMinutes: Number(form.get('overlap')),
                    })
                  ).then(value => setSecret(value.token)),
                'Credential created. Copy it now and verify the provider before retiring its predecessor.'
              );
            }}
          >
            <label className="text-sm">
              Purpose
              <input
                name="name"
                required
                maxLength={100}
                className={fieldClass}
                placeholder="Entra production provisioning"
              />
            </label>
            <label className="text-sm">
              Lifetime in days
              <input
                name="days"
                type="number"
                min={1}
                max={365}
                defaultValue={90}
                className={fieldClass}
                required
              />
            </label>
            <label className="text-sm">
              Previous credential overlap in minutes
              <input
                name="overlap"
                type="number"
                min={0}
                max={1440}
                defaultValue={60}
                className={fieldClass}
                required
              />
            </label>
            <fieldset className="space-y-1 text-sm">
              <legend>Scopes</legend>
              {['users:read', 'users:write', 'groups:read', 'groups:write'].map(scope => (
                <label className="mr-3 inline-flex gap-1" key={scope}>
                  <input type="checkbox" name="scope" value={scope} defaultChecked />
                  {scope}
                </label>
              ))}
            </fieldset>
            <Button disabled={busy || !connector?.enabled} type="submit">
              Create replacement credential
            </Button>
          </form>
          {secret && (
            <div className="rounded-lg border p-3 space-y-2">
              <label className="text-sm">
                One-time secret
                <input
                  className={fieldClass}
                  readOnly
                  value={secret}
                  onFocus={e => e.target.select()}
                />
              </label>
              <Button variant="outline" onClick={() => setSecret(null)}>
                Hide secret permanently
              </Button>
            </div>
          )}
          <ul className="divide-y rounded-lg border">
            {connector?.credentials.map(credential => (
              <li key={credential.id} className="p-3 space-y-1 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {credential.name} · generation {credential.generation} · …{credential.tokenHint}
                  </span>
                  <Badge variant="outline">
                    {credential.revokedAt
                      ? 'Revoked'
                      : new Date(credential.expiresAt).getTime() <= observedAt
                        ? 'Expired'
                        : 'Active'}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Owner {credential.createdBy} · Expires {date(credential.expiresAt)} · Last used{' '}
                  {date(credential.lastUsedAt)}
                </p>
                <p className="text-xs">{credential.scopes.join(', ')}</p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || Boolean(credential.revokedAt)}
                  onClick={() =>
                    void run(
                      () => result(revokeScimCredentialAction(credential.id)),
                      'Credential revoked immediately.'
                    )
                  }
                >
                  Revoke credential
                </Button>
              </li>
            ))}
          </ul>
          {connector?.credentials.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No registry credentials. Create one to migrate legacy authentication.
            </p>
          )}
        </div>
      )}
      {tab === 'Diagnostics' && (
        <div className="space-y-3 text-sm">
          <h4 className="font-semibold">Directory drift and account mapping</h4>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(
                () => result(scimDriftAction({ connectorId: selected, page: 1 })).then(setDrift),
                'Compared the first 25 local group bindings. Provider-side state requires provider diagnostics.'
              )
            }
          >
            Compare local memberships
          </Button>
          <ul className="space-y-2">
            {drift.map(item => (
              <li key={item.groupId + item.teamId}>
                {item.group} → {item.team}: {item.missingMembers} missing operational members.{' '}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setGroupId(item.groupId);
                    setTeamId(item.teamId);
                    setImpact(null);
                    setTab('Users & Groups');
                    setKind('groups');
                  }}
                >
                  Preview repair
                </Button>
              </li>
            ))}
          </ul>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={e => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              void run(
                () =>
                  result(
                    bindExistingScimUserAction({
                      connectorId: selected,
                      userId: form.get('userId'),
                      externalId: form.get('externalId'),
                    })
                  ),
                'Account binding approved. Role authority and current status were preserved.'
              );
            }}
          >
            <label>
              Existing OpsKnight user ID
              <input name="userId" required className={fieldClass} />
            </label>
            <label>
              Verified immutable directory ID
              <input name="externalId" required className={fieldClass} />
            </label>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Verify both identifiers against the user and provider before approving lifecycle
              ownership. This allows the selected connection to update or disable that account.
            </p>
            <Button disabled={busy} type="submit">
              Approve existing account binding
            </Button>
          </form>
          <h4 className="font-semibold">Troubleshooting</h4>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              401: check connection state, expiry and revocation. Database authentication failures
              never enable environment-token fallback.
            </li>
            <li>403: create a credential with the required users or groups scope.</li>
            <li>
              409: query externalId to find the existing identity. Email collisions require
              administrator review; they never adopt local accounts automatically.
            </li>
            <li>
              400 unknown members: provision users through the same connection before synchronizing
              memberships.
            </li>
            <li>
              400 unsupported path: remove unmapped attributes or use the supported schema paths
              shown in setup.
            </li>
            <li>
              429 or 503: honor Retry-After. Retry the same operation; query the immutable identity
              after an uncertain response.
            </li>
            <li>
              Administrator continuity: add another active administrator before disabling the last
              one. Emergency accounts remain independent.
            </li>
            <li>
              Offboarding: Activity records access revocation and affected teams/future on-call
              shifts. Review coverage before the next rotation.
            </li>
            <li>
              Rehire: approve restoration in Users &amp; Groups, then reactivate the existing user
              from the provider.
            </li>
          </ul>
          <p className="text-muted-foreground">
            A connection is verified only after its real lifecycle journeys pass. Entra and Okta
            certification, load and multiple-replica evidence are release gates.
          </p>
        </div>
      )}
    </section>
  );
}
