'use client';
/* eslint-disable no-alert -- Native confirmations provide blocking, keyboard-accessible decisions for security-changing actions. */

import { useEffect, useRef, useState } from 'react';
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
  scimTeamPageAction,
  scimConnectionPageAction,
  scimCredentialPageAction,
  bindExistingScimUserAction,
  scimDriftAction,
} from '@/app/(app)/settings/system/scim-actions';

export type ScimConfigProps = {
  enabled: boolean;
  hasSecretToken: boolean;
  tokenHint: string | null;
  source: 'DATABASE' | 'ENV' | 'NONE';
  legacyCredentialSource?: 'DATABASE' | 'ENV' | null;
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
  const [connectionPage, setConnectionPage] = useState(1);
  const [connectionQuery, setConnectionQuery] = useState('');
  const [connectionList, setConnectionList] = useState<
    Data<ReturnType<typeof scimConnectionPageAction>>
  >({ rows: [], total: 0 });
  const [credentialPage, setCredentialPage] = useState(1);
  const [credentialStatus, setCredentialStatus] = useState<
    'active' | 'expired' | 'revoked' | 'all'
  >('active');
  const [credentialList, setCredentialList] = useState<
    Data<ReturnType<typeof scimCredentialPageAction>>
  >({ rows: [], total: 0 });
  const [credentialLoading, setCredentialLoading] = useState(true);
  const [driftPage, setDriftPage] = useState(1);
  const [driftChecked, setDriftChecked] = useState(false);
  const [teamPage, setTeamPage] = useState(1);
  const [teamTotal, setTeamTotal] = useState(0);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const operationPending = useRef(false);
  const connectionEpoch = useRef(0);
  const [loading, setLoading] = useState(true);
  const [overviewLoading, setOverviewLoading] = useState(true);
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
  const [adoptMemberIds, setAdoptMemberIds] = useState<string[]>([]);
  const [verification, setVerification] = useState(false);
  const [impactStale, setImpactStale] = useState(false);
  const [legacyCutoverAcknowledged, setLegacyCutoverAcknowledged] = useState(false);
  const [impact, setImpact] = useState<Impact | null>(null);
  const connector = connectors.find(c => c.id === selected);
  const legacyConnector = connectors.find(c => c.id === 'legacy');
  const legacyCredentialSource = legacyConnector
    ? legacyConnector.legacyCredentialSource
    : initialConfig.legacyCredentialSource;
  useEffect(() => {
    let current = true;
    result(scimOverviewAction({ selectedId: selected }))
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
        if (current) {
          setLoading(false);
          setOverviewLoading(false);
        }
      });
    return () => {
      current = false;
    };
  }, [reload, selected]);
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      void result(scimConnectionPageAction({ page: connectionPage, query: connectionQuery }))
        .then(data => {
          if (current) setConnectionList(data);
        })
        .catch(() => {
          if (current) setError('Cannot load connections.');
        });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [connectionPage, connectionQuery, reload]);
  useEffect(() => {
    if (tab !== 'Security') return;
    let current = true;
    void result(
      scimCredentialPageAction({
        connectorId: selected,
        page: credentialPage,
        status: credentialStatus,
      })
    )
      .then(data => {
        if (current) {
          setCredentialList(data);
          setObservedAt(Date.now());
        }
      })
      .catch(() => {
        if (current) setError('Cannot load credentials.');
      })
      .finally(() => {
        if (current) setCredentialLoading(false);
      });
    return () => {
      current = false;
    };
  }, [selected, credentialPage, credentialStatus, tab, reload]);
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
        result(
          scimTeamPageAction({
            query: teamQuery,
            page: teamPage,
            ...(teamId ? { selectedId: teamId } : {}),
          })
        )
          .then(data => {
            if (current) {
              setTeams(
                data.selected && !data.rows.some(row => row.id === data.selected?.id)
                  ? [data.selected, ...data.rows]
                  : data.rows
              );
              setTeamTotal(data.total);
            }
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
  }, [groupId, teamQuery, teamPage, teamId]);
  useEffect(() => {
    if (!secret) return;
    const timer = setTimeout(() => setSecret(null), 300000);
    return () => clearTimeout(timer);
  }, [secret]);
  async function run(operation: () => Promise<unknown>, message: string) {
    if (operationPending.current) return;
    operationPending.current = true;
    const epoch = connectionEpoch.current;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
      if (epoch !== connectionEpoch.current) return;
      setNotice(message);
      setOverviewLoading(true);
      setCredentialLoading(true);
      setReload(v => v + 1);
    } catch (e) {
      if (epoch === connectionEpoch.current)
        setError(e instanceof Error ? e.message : 'Operation failed. Try again.');
    } finally {
      operationPending.current = false;
      setBusy(false);
    }
  }
  async function loadDrift(nextPage: number) {
    const epoch = connectionEpoch.current;
    const rows = await result(scimDriftAction({ connectorId: selected, page: nextPage }));
    if (epoch === connectionEpoch.current) {
      setDrift(rows);
      setDriftPage(nextPage);
      setDriftChecked(true);
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
              setCredentialLoading(true);
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
          disabled={busy}
          aria-label="SCIM connection"
          className={fieldClass}
          value={selected}
          onChange={e => {
            connectionEpoch.current++;
            setSelected(e.target.value);
            setOverviewLoading(true);
            setCredentialPage(1);
            setCredentialList({ rows: [], total: 0 });
            setCredentialLoading(true);
            setDrift([]);
            setDriftPage(1);
            setDriftChecked(false);
            setTeamId('');
            setTeams([]);
            setTeamPage(1);
            setVerification(false);
            setLegacyCutoverAcknowledged(false);
            setAdoptMemberIds([]);
            setImpact(null);
            setPage(1);
            setSecret(null);
            setGroupId('');
          }}
        >
          {[
            ...connectionList.rows,
            ...connectors.filter(item => !connectionList.rows.some(row => row.id === item.id)),
          ].map(c => (
            <option value={c.id} key={c.id}>
              {c.name} ({c.provider})
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        Find a connection
        <input
          className={fieldClass}
          value={connectionQuery}
          onChange={e => {
            setConnectionQuery(e.target.value);
            setConnectionPage(1);
          }}
        />
      </label>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Button
          variant="outline"
          disabled={busy || connectionPage === 1}
          onClick={() => setConnectionPage(value => value - 1)}
        >
          Previous connections
        </Button>
        <span>
          Connection page {connectionPage} · {connectionList.total} records
        </span>
        <Button
          variant="outline"
          disabled={busy || connectionPage * 25 >= connectionList.total}
          onClick={() => setConnectionPage(value => value + 1)}
        >
          Next connections
        </Button>
      </div>
      {(overviewLoading || (loading && (tab === 'Users & Groups' || tab === 'Activity'))) && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading provisioning data…
        </p>
      )}
      {legacyCredentialSource &&
        connectors.some(
          c => c.id === 'legacy' && c.enabled && c.credentialAuthority === 'LEGACY'
        ) && (
          <p role="status" className="text-sm text-amber-700 dark:text-amber-300">
            Legacy {legacyCredentialSource === 'ENV' ? 'environment' : 'database'} authentication is
            active on the legacy connection, independently of other connections. Switching that
            connection to registry credentials retires its old token immediately.
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
            key={`${selected}:${reload}:${Boolean(connector)}`}
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={e => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              if (connector?.enabled && form.get('enabled') !== 'on' && form.get('new') !== 'on') {
                if (
                  !window.confirm(
                    'Disable provisioning? All credentials for this connector will be rejected until it is explicitly enabled again. Existing users are not deleted.'
                  )
                )
                  return;
              }
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
            <fieldset
              disabled={busy || overviewLoading || !connector}
              className="col-span-full grid min-w-0 gap-3 border-0 p-0 sm:grid-cols-2"
            >
              <legend className="sr-only">Connection configuration</legend>
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
                  <input
                    type="checkbox"
                    name="enabled"
                    defaultChecked={connector?.enabled ?? true}
                  />
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
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Trusted first linking requires Microsoft Entra, the exact tenant issuer
                https://login.microsoftonline.com/TENANT-ID/v2.0 and the client ID registered for
                OpsKnight SSO. Immutable oid and tid claims must match; email alone never links
                accounts. Keep this disabled when those claims cannot be verified and use explicit
                account approval.
              </p>
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
            </fieldset>
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
                      setAdoptMemberIds([]);
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
                  onChange={e => {
                    setTeamQuery(e.target.value);
                    setTeamPage(1);
                  }}
                />
              </label>
              <label className="block text-sm">
                Operational team
                <select
                  className={fieldClass}
                  value={teamId}
                  aria-label="Operational team"
                  disabled={busy}
                  onChange={e => {
                    setTeamId(e.target.value);
                    setAdoptMemberIds([]);
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
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  disabled={busy || teamPage === 1}
                  onClick={() => setTeamPage(value => value - 1)}
                >
                  Previous teams
                </Button>
                <span>
                  Team page {teamPage} · {teamTotal} records
                </span>
                <Button
                  variant="outline"
                  disabled={busy || teamPage * 25 >= teamTotal}
                  onClick={() => setTeamPage(value => value + 1)}
                >
                  Next teams
                </Button>
              </div>
              <Button
                disabled={busy || !teamId}
                variant="outline"
                onClick={() =>
                  void run(
                    () =>
                      result(previewScimBindingAction({ groupId, teamId, adoptMemberIds })).then(
                        value => {
                          setImpact(value);
                          setImpactStale(false);
                        }
                      ),
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
                  {impactStale ? (
                    <p role="status">
                      Selections changed. Refresh the impact preview before approval.
                    </p>
                  ) : (
                    <p>
                      {impact.additions} members added; {impact.removals} existing memberships
                      removed; {impact.transfers} grants transferred; {impact.protectedOwners}{' '}
                      owners protected; {impact.sessionInvalidations} users’ sessions invalidated.
                    </p>
                  )}
                  {impact.legacyCandidates.length > 0 && (
                    <fieldset className="space-y-2">
                      <legend>Legacy ownership adoption (optional)</legend>
                      <p>
                        Select only memberships verified as directory-managed. Unselected members
                        and owners remain independently managed. Preview again after changing
                        selections.
                      </p>
                      {impact.legacyCandidates.map(member => (
                        <label key={member.id} className="flex gap-2">
                          <input
                            type="checkbox"
                            disabled={busy}
                            checked={adoptMemberIds.includes(member.id)}
                            onChange={event => {
                              setImpactStale(true);
                              setAdoptMemberIds(ids =>
                                event.target.checked
                                  ? [...ids, member.id]
                                  : ids.filter(id => id !== member.id)
                              );
                            }}
                          />{' '}
                          Adopt directory ownership for {member.userId}
                        </label>
                      ))}
                      {!impactStale && (
                        <p>
                          {impact.adoptedMemberships} memberships approved for adoption;{' '}
                          {impact.retainedManualMemberships} manual memberships retained.
                        </p>
                      )}
                    </fieldset>
                  )}
                  <p>
                    {impact.services} services and {impact.escalations} escalation rules use this
                    team.
                  </p>
                  <Button
                    disabled={busy || impactStale}
                    onClick={() =>
                      void run(
                        () =>
                          result(
                            approveScimBindingAction({
                              groupId,
                              teamId,
                              revision: impact.revision,
                              adoptMemberIds,
                            })
                          ).then(() => {
                            setImpact(null);
                            setAdoptMemberIds([]);
                          }),
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
                  void run(async () => {
                    if (
                      !window.confirm(
                        'Detach this binding and revoke its directory-owned team access? Manual owners and independent grants remain.'
                      )
                    )
                      throw new Error('Detachment cancelled. No access changed.');
                    return result(detachScimBindingAction({ groupId, teamId }));
                  }, 'Binding detached. Directory-owned access revoked; manual access retained.')
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
                      acknowledgeLegacyCutover: legacyCutoverAcknowledged,
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
            {connector?.id === 'legacy' && connector.credentialAuthority === 'LEGACY' && (
              <label className="sm:col-span-2 flex gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={legacyCutoverAcknowledged}
                  onChange={event => setLegacyCutoverAcknowledged(event.target.checked)}
                />
                I acknowledge that registry cutover immediately retires the legacy token. Its
                overlap does not apply.
              </label>
            )}
            <Button
              disabled={
                busy ||
                !connector?.enabled ||
                (connector.id === 'legacy' &&
                  connector.credentialAuthority === 'LEGACY' &&
                  !legacyCutoverAcknowledged)
              }
              type="submit"
            >
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
          <label className="block text-sm">
            Credential status
            <select
              aria-label="Credential status"
              className={fieldClass}
              value={credentialStatus}
              onChange={e => {
                setCredentialStatus(e.target.value as typeof credentialStatus);
                setCredentialPage(1);
                setCredentialLoading(true);
              }}
            >
              <option value="active">Active</option>
              <option value="expired">Expired</option>
              <option value="revoked">Revoked</option>
              <option value="all">All</option>
            </select>
          </label>
          {credentialLoading && <p role="status">Loading credentials…</p>}
          <ul className="divide-y rounded-lg border">
            {credentialList.rows.map(credential => (
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
                        : !connector?.enabled
                          ? 'Blocked · connection disabled'
                          : connector.credentialAuthority !== 'REGISTRY'
                            ? 'Blocked · registry inactive'
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
                    void run(async () => {
                      if (
                        !window.confirm(
                          'Revoke this credential immediately? Provider requests using it will fail. Verify a replacement before continuing.'
                        )
                      )
                        throw new Error('Revocation cancelled. Credential remains active.');
                      return result(revokeScimCredentialAction(credential.id));
                    }, 'Credential revoked immediately.')
                  }
                >
                  Revoke credential
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Button
              variant="outline"
              disabled={busy || credentialLoading || credentialPage === 1}
              onClick={() => {
                setCredentialPage(value => value - 1);
                setCredentialLoading(true);
              }}
            >
              Previous credentials
            </Button>
            <span>
              Credential page {credentialPage} · {credentialList.total} records
            </span>
            <Button
              variant="outline"
              disabled={busy || credentialLoading || credentialPage * 25 >= credentialList.total}
              onClick={() => {
                setCredentialPage(value => value + 1);
                setCredentialLoading(true);
              }}
            >
              Next credentials
            </Button>
          </div>
          {!credentialLoading && credentialList.rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No credentials match this status filter.
            </p>
          )}
        </div>
      )}
      {tab === 'Diagnostics' && (
        <div className="space-y-3 text-sm">
          <h4 className="font-semibold">Provisioning verification</h4>
          <p>
            Credential connectivity only proves authentication. In your provider, create a
            disposable assigned user, update its profile, disable it and verify the corresponding
            Activity events. Use fresh group assignments to verify team access. Provider Test
            Connection alone is insufficient.
          </p>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setVerification(true);
              setTab('Activity');
              setQuery('user.');
            }}
          >
            Review provisioning evidence
          </Button>
          {verification && (
            <p role="status">
              Verification in progress: inspect created, updated and disabled events for the same
              disposable user. This does not certify a live provider.
            </p>
          )}
          <h4 className="font-semibold">Directory drift and account mapping</h4>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(
                () => loadDrift(1),
                'Compared local group bindings. Provider-side state requires provider diagnostics.'
              )
            }
          >
            Compare local memberships
          </Button>
          <ul className="space-y-2">
            {drift.map(item => (
              <li key={item.groupId + item.teamId}>
                {item.group} → {item.team}: {item.missingMembers} missing operational members;{' '}
                {item.unexpectedDirectoryGrants} unexpected directory grants;{' '}
                {item.independentManualMembers} independent manual members.{' '}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setGroupId(item.groupId);
                    setTeamId(item.teamId);
                    setTeamQuery('');
                    setTeamPage(1);
                    setAdoptMemberIds([]);
                    setImpactStale(false);
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
          {driftChecked && (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                disabled={busy || driftPage === 1}
                onClick={() =>
                  void run(() => loadDrift(driftPage - 1), 'Previous drift page loaded.')
                }
              >
                Previous drift
              </Button>
              <span>Drift page {driftPage}</span>
              <Button
                variant="outline"
                disabled={busy || drift.length < 25}
                onClick={() => void run(() => loadDrift(driftPage + 1), 'Next drift page loaded.')}
              >
                Next drift
              </Button>
            </div>
          )}
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
