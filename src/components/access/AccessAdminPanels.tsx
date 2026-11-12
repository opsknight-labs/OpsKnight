'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  CircleSlash,
  ClipboardCheck,
  Download,
  Info,
  Pencil,
  Plus,
  Search,
  ShieldPlus,
  Trash2,
  UserSearch,
  XCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/shadcn/button';
import { Checkbox } from '@/components/ui/shadcn/checkbox';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Switch } from '@/components/ui/shadcn/switch';
import { ListEmpty, StatusPill } from '@/components/settings/mcp/McpListKit';
import { PersonCell } from '@/components/access/AccessUi';
import SimpleSelect from '@/components/access/SimpleSelect';
import { cn } from '@/lib/utils';
import {
  ALL_CATALOGUED_CAPABILITIES,
  CAPABILITY_GROUPS,
  capabilityGroupLabel,
  capabilityInfo,
} from '@/lib/access/catalog';
import { roleLabel, type AppRole, type Capability } from '@/lib/authorization';
import {
  archiveCustomRoleAction,
  assignCustomRoleAction,
  checkAccessAction,
  cancelAccessReviewAction,
  completeAccessReviewAction,
  decideAccessReviewItemAction,
  saveCustomRoleAction,
  startAccessReviewAction,
  updateAccessPolicyAction,
  whoHasCapabilityAction,
} from '@/app/(app)/settings/access/admin/actions';
import type { AccessCheckResult } from '@/lib/access/admin';
import { signInAgain } from '@/components/access/SignInAgainButton';

const RETURN_PATH = '/settings/access/admin';

/** Bottom bar for a form inside a settings section: feedback on the left, actions on the right. */
function FormFooter({
  children,
  feedback,
}: {
  children: React.ReactNode;
  feedback?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">{feedback}</div>
      <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>
    </div>
  );
}

const CAPABILITY_OPTIONS = ALL_CATALOGUED_CAPABILITIES.map(option => ({
  value: option,
  label: capabilityInfo(option).label,
}));

type UserOption = { id: string; name: string | null; email: string; role: string };

function Feedback({
  result,
}: {
  result: { ok: boolean; message?: string; error?: string; code?: string } | null;
}) {
  if (!result) return null;
  if (result.ok) {
    return result.message ? (
      <p
        role="status"
        className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400"
      >
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
        {result.message}
      </p>
    ) : null;
  }
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-2 text-sm text-rose-600 dark:text-rose-400"
    >
      <XCircle className="h-4 w-4 shrink-0" aria-hidden />
      <span>{result.error}</span>
      {result.code === 'STEP_UP_REQUIRED' && (
        <Button size="sm" variant="outline" onClick={() => signInAgain(RETURN_PATH)}>
          Sign in again
        </Button>
      )}
    </div>
  );
}

function userLabel(user: UserOption) {
  return `${user.name ?? user.email} · ${roleLabel(user.role as AppRole)}`;
}

// ─── Policy ─────────────────────────────────────────────────────────────────

export type AccessPolicyValues = {
  userIncidentActionsEnabled: boolean;
  requestsEnabled: boolean;
  breakGlassEnabled: boolean;
  breakGlassMaxMinutes: number;
  selfApprovalAllowed: boolean;
  reviewIntervalDays: number | null;
};

const REVIEW_INTERVAL_LABELS = new Map([
  [30, 'Monthly'],
  [90, 'Quarterly'],
  [180, 'Twice a year'],
  [365, 'Yearly'],
]);

/** Presets plus a saved value that isn't one of them, so the select never shows blank. */
function withCurrent(presets: number[], current: number | null) {
  return current && !presets.includes(current)
    ? [...presets, current].sort((a, b) => a - b)
    : presets;
}

export function AccessPolicyForm({ initial }: { initial: AccessPolicyValues }) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [result, setResult] = useState<Parameters<typeof Feedback>[0]['result']>(null);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof AccessPolicyValues>(key: K, value: AccessPolicyValues[K]) =>
    setValues(current => ({ ...current, [key]: value }));

  const toggles: { key: keyof AccessPolicyValues; label: string; help: string }[] = [
    {
      key: 'userIncidentActionsEnabled',
      label: 'People can work their own incidents',
      help: 'Users can acknowledge, add notes, escalate and resolve incidents assigned to them, that page them, or that belong to their teams.',
    },
    {
      key: 'requestsEnabled',
      label: 'Access requests',
      help: 'People can request a role or team membership from the Access denied page and My access.',
    },
    {
      key: 'breakGlassEnabled',
      label: 'Emergency (break-glass) access',
      help: 'People can give themselves temporary Responder access during an emergency. Admins are alerted and every action is audited.',
    },
    {
      key: 'selfApprovalAllowed',
      label: 'Allow approving your own requests',
      help: 'When off, nobody can approve their own access request (separation of duties). Turn on only if you have a single administrator. Runbook approvals and AI assistant changes follow their own review rules.',
    },
  ];

  return (
    <div className="space-y-5">
      <div className="divide-y divide-border rounded-lg border border-border">
        {toggles.map(toggle => (
          <div key={toggle.key} className="flex items-start justify-between gap-6 p-4">
            <div className="space-y-1">
              <Label htmlFor={`policy-${toggle.key}`} className="text-sm font-medium">
                {toggle.label}
              </Label>
              <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
                {toggle.help}
              </p>
            </div>
            <Switch
              id={`policy-${toggle.key}`}
              checked={Boolean(values[toggle.key])}
              onCheckedChange={checked => set(toggle.key, checked as never)}
              className="mt-0.5 shrink-0"
            />
          </div>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="policy-break-glass-max">Longest emergency access</Label>
          <SimpleSelect
            id="policy-break-glass-max"
            value={String(values.breakGlassMaxMinutes)}
            onValueChange={value => set('breakGlassMaxMinutes', Number(value))}
            options={withCurrent([15, 30, 60, 120, 240], initial.breakGlassMaxMinutes).map(
              minutes => ({
                value: String(minutes),
                label:
                  minutes < 60
                    ? `${minutes} minutes`
                    : `${minutes / 60} hour${minutes === 60 ? '' : 's'}`,
              })
            )}
          />
          <p className="text-xs text-muted-foreground">The most anyone can choose at once.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="policy-review-interval">Automatic access reviews</Label>
          <SimpleSelect
            id="policy-review-interval"
            value={values.reviewIntervalDays ? String(values.reviewIntervalDays) : 'off'}
            onValueChange={value =>
              set('reviewIntervalDays', value === 'off' ? null : Number(value))
            }
            options={[
              { value: 'off', label: 'Off' },
              ...withCurrent([30, 90, 180, 365], initial.reviewIntervalDays).map(days => ({
                value: String(days),
                label: REVIEW_INTERVAL_LABELS.get(days) ?? `Every ${days} days`,
              })),
            ]}
          />
          <p className="text-xs text-muted-foreground">Starts a review on this schedule.</p>
        </div>
      </div>
      <FormFooter feedback={<Feedback result={result} />}>
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const outcome = await updateAccessPolicyAction(values);
              setResult(outcome);
              if (outcome.ok) router.refresh();
            })
          }
        >
          {pending ? 'Saving…' : 'Save policy'}
        </Button>
      </FormFooter>
    </div>
  );
}

// ─── Access checker ─────────────────────────────────────────────────────────

export function AccessChecker({ users }: { users: UserOption[] }) {
  const [userId, setUserId] = useState(users[0]?.id ?? '');
  const [kind, setKind] = useState<'page' | 'incident' | 'capability'>('page');
  const [path, setPath] = useState('/audit');
  const [incidentId, setIncidentId] = useState('');
  const [action, setAction] = useState<
    'view' | 'acknowledge' | 'note' | 'escalate' | 'resolve' | 'manage'
  >('acknowledge');
  const [capability, setCapability] = useState<Capability>('runbook.execute' as Capability);
  const [result, setResult] = useState<AccessCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    startTransition(async () => {
      const outcome = await checkAccessAction(
        kind === 'page'
          ? { kind, userId, path }
          : kind === 'incident'
            ? {
                kind,
                userId,
                incidentId: incidentId.trim().split('/').filter(Boolean).pop() ?? '',
                action,
              }
            : { kind, userId, capability }
      );
      if (outcome.ok && outcome.data) setResult(outcome.data);
      else {
        setResult(null);
        setError(outcome.ok ? 'No result.' : outcome.error);
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="check-user">Person</Label>
          <SimpleSelect
            id="check-user"
            value={userId}
            onValueChange={setUserId}
            placeholder="Choose a person"
            options={users.map(user => ({ value: user.id, label: userLabel(user) }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="check-kind">Check</Label>
          <SimpleSelect
            id="check-kind"
            value={kind}
            onValueChange={value => setKind(value as typeof kind)}
            options={[
              { value: 'page', label: 'Opening a page' },
              { value: 'incident', label: 'An action on an incident' },
              { value: 'capability', label: 'A permission' },
            ]}
          />
        </div>
        {kind === 'page' && (
          <div className="space-y-1.5">
            <Label htmlFor="check-path">Page path</Label>
            <Input
              id="check-path"
              value={path}
              onChange={event => setPath(event.target.value)}
              placeholder="/runbooks"
              className="font-mono text-sm"
            />
          </div>
        )}
        {kind === 'capability' && (
          <div className="space-y-1.5">
            <Label htmlFor="check-capability">Permission</Label>
            <SimpleSelect
              id="check-capability"
              value={capability}
              onValueChange={value => setCapability(value as Capability)}
              options={CAPABILITY_OPTIONS}
            />
          </div>
        )}
        {kind === 'incident' && (
          <div className="space-y-1.5">
            <Label htmlFor="check-action">Action</Label>
            <SimpleSelect
              id="check-action"
              value={action}
              onValueChange={value => setAction(value as typeof action)}
              options={[
                { value: 'view', label: 'View' },
                { value: 'acknowledge', label: 'Acknowledge' },
                { value: 'note', label: 'Add a note' },
                { value: 'escalate', label: 'Escalate' },
                { value: 'resolve', label: 'Resolve' },
                { value: 'manage', label: 'Change urgency, reassign, snooze…' },
              ]}
            />
          </div>
        )}
      </div>
      {kind === 'incident' && (
        <div className="space-y-1.5">
          <Label htmlFor="check-incident">Incident ID or link</Label>
          <Input
            id="check-incident"
            value={incidentId}
            onChange={event => setIncidentId(event.target.value)}
            placeholder="https://…/incidents/clx…"
            className="font-mono text-sm"
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={run} disabled={pending || !userId} className="gap-1.5">
          <Search className="h-4 w-4" aria-hidden />
          {pending ? 'Checking…' : 'Check access'}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
            {error}
          </p>
        )}
      </div>
      {result && (
        <div
          role="status"
          className={cn(
            'overflow-hidden rounded-lg border',
            result.allowed
              ? 'border-emerald-200 dark:border-emerald-900/50'
              : 'border-rose-200 dark:border-rose-900/50'
          )}
        >
          <p
            className={cn(
              'flex items-center gap-2 px-4 py-3 text-sm font-semibold',
              result.allowed
                ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'
                : 'bg-rose-50 text-rose-900 dark:bg-rose-950/30 dark:text-rose-200'
            )}
          >
            {result.allowed ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            ) : (
              <XCircle className="h-4 w-4 shrink-0" aria-hidden />
            )}
            {result.summary}
          </p>
          <ol className="divide-y divide-border bg-card">
            {result.steps.map((step, index) => (
              <li key={index} className="flex gap-3 px-4 py-2.5 text-sm">
                {step.outcome === 'pass' ? (
                  <CheckCircle2
                    className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                    aria-label="Pass"
                  />
                ) : step.outcome === 'fail' ? (
                  <CircleSlash
                    className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400"
                    aria-label="Fail"
                  />
                ) : (
                  <Info
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                    aria-label="Info"
                  />
                )}
                <span className="min-w-0">
                  <span className="font-medium text-foreground">{step.label}</span>
                  <span className="block text-muted-foreground">{step.detail}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// ─── Who has access ─────────────────────────────────────────────────────────

type WhoHasData = Extract<Awaited<ReturnType<typeof whoHasCapabilityAction>>, { ok: true }>['data'];

export function WhoHasAccess() {
  const [capability, setCapability] = useState<Capability>('audit.read' as Capability);
  const [data, setData] = useState<WhoHasData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const total = data ? data.byRole.length + data.byCustomRole.length + data.byGrant.length : 0;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="who-capability">Permission</Label>
          <SimpleSelect
            id="who-capability"
            value={capability}
            onValueChange={value => setCapability(value as Capability)}
            options={CAPABILITY_OPTIONS}
          />
        </div>
        <Button
          disabled={pending}
          className="gap-1.5"
          onClick={() =>
            startTransition(async () => {
              const outcome = await whoHasCapabilityAction(capability);
              if (outcome.ok) {
                setData(outcome.data);
                setError(null);
              } else setError(outcome.error);
            })
          }
        >
          <UserSearch className="h-4 w-4" aria-hidden />
          {pending ? 'Looking…' : 'Show people'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
      {data && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {total} {total === 1 ? 'person' : 'people'}
            </span>{' '}
            · built-in roles with this permission:{' '}
            {data.roles.length ? data.roles.map(role => roleLabel(role)).join(', ') : 'none'}
          </p>
          {total === 0 ? (
            <div className="rounded-lg border border-dashed border-border">
              <ListEmpty
                icon={<UserSearch className="h-5 w-5" aria-hidden />}
                title="Nobody has this permission"
              >
                Assign a role or a custom role that includes it.
              </ListEmpty>
            </div>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {data.byRole.map(user => (
                <li
                  key={`r-${user.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <PersonCell name={user.name} email={user.email} />
                  <StatusPill tone="neutral">{roleLabel(user.role as AppRole)} role</StatusPill>
                </li>
              ))}
              {data.byCustomRole.map(user => (
                <li
                  key={`c-${user.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <PersonCell name={user.name} email={user.email} />
                  <StatusPill tone="violet">Custom: {user.customRole}</StatusPill>
                </li>
              ))}
              {data.byGrant.map(grant => (
                <li
                  key={`g-${grant.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <PersonCell
                    name={grant.user.name}
                    email={grant.user.email}
                    meta={`Until ${new Date(grant.expiresAt).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}`}
                  />
                  <StatusPill tone={grant.source === 'BREAK_GLASS' ? 'warning' : 'info'}>
                    Temporary {roleLabel(grant.role as AppRole)}
                  </StatusPill>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Custom roles ───────────────────────────────────────────────────────────

type CustomRoleView = {
  id: string;
  name: string;
  description: string | null;
  capabilities: string[];
  holders: number;
};

const DELEGABLE = ALL_CATALOGUED_CAPABILITIES.filter(capability => capability !== 'admin.manage');

export function CustomRolesManager({
  roles,
  users,
  assignments,
}: {
  roles: CustomRoleView[];
  users: UserOption[];
  assignments: { userId: string; customRoleId: string }[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<CustomRoleView | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<Parameters<typeof Feedback>[0]['result']>(null);
  const [assignUser, setAssignUser] = useState(users[0]?.id ?? '');
  const [assignRole, setAssignRole] = useState(roles[0]?.id ?? '');
  const [pending, startTransition] = useTransition();

  const grouped = useMemo(
    () =>
      CAPABILITY_GROUPS.map(group => ({
        group,
        label: capabilityGroupLabel(group),
        items: DELEGABLE.filter(capability => capabilityInfo(capability).group === group),
      })).filter(group => group.items.length > 0),
    []
  );

  function edit(role: CustomRoleView | null) {
    setEditing(role ?? { id: '', name: '', description: null, capabilities: [], holders: 0 });
    setName(role?.name ?? '');
    setDescription(role?.description ?? '');
    setSelected(new Set(role?.capabilities ?? []));
    setResult(null);
  }

  const assignedRoleFor = (userId: string) =>
    assignments.find(assignment => assignment.userId === userId)?.customRoleId ?? null;

  const assignedName = (userId: string) => {
    const roleId = assignedRoleFor(userId);
    return roleId ? (roles.find(role => role.id === roleId)?.name ?? 'a custom role') : null;
  };

  return (
    <div className="space-y-5">
      {roles.length === 0 && !editing ? (
        <div className="rounded-lg border border-dashed border-border">
          <ListEmpty
            icon={<ShieldPlus className="h-5 w-5" aria-hidden />}
            title="No custom roles yet"
            action={
              <Button onClick={() => edit(null)} className="gap-1.5">
                <Plus className="h-4 w-4" aria-hidden />
                New custom role
              </Button>
            }
          >
            Give specific people extra permissions without making them Responders or Admins.
          </ListEmpty>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {roles.map(role => (
            <div
              key={role.id}
              className={cn(
                'flex flex-col gap-3 rounded-lg border bg-card p-4',
                editing?.id === role.id
                  ? 'border-primary/50 ring-2 ring-primary/20'
                  : 'border-border'
              )}
            >
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-semibold text-foreground">{role.name}</p>
                {role.description && (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {role.description}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <StatusPill tone="info">
                  {role.capabilities.length} permission{role.capabilities.length === 1 ? '' : 's'}
                </StatusPill>
                <StatusPill tone="neutral">
                  {role.holders} {role.holders === 1 ? 'person' : 'people'}
                </StatusPill>
              </div>
              <div className="mt-auto flex justify-end gap-2 border-t border-border pt-3">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  className="gap-1.5 text-muted-foreground hover:text-destructive"
                  onClick={() =>
                    startTransition(async () => {
                      const outcome = await archiveCustomRoleAction(role.id);
                      setResult(outcome);
                      if (outcome.ok) router.refresh();
                    })
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  Remove
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => edit(role)}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                  Edit
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {!editing && roles.length > 0 && (
        <Button variant="outline" onClick={() => edit(null)} className="gap-1.5">
          <Plus className="h-4 w-4" aria-hidden />
          New custom role
        </Button>
      )}

      {editing && (
        <div className="space-y-5 rounded-lg border border-border bg-muted/20 p-4 md:p-5">
          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-foreground">
              {editing.id ? `Edit ${editing.name}` : 'New custom role'}
            </h4>
            <p className="text-xs text-muted-foreground">
              These permissions are added on top of each holder’s built-in role. Organization
              administration can only be granted with the Admin role.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="custom-role-name">Name</Label>
              <Input
                id="custom-role-name"
                value={name}
                maxLength={60}
                onChange={event => setName(event.target.value)}
                placeholder="Runbook operator"
                className="bg-background"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="custom-role-description">Description</Label>
              <Input
                id="custom-role-description"
                value={description}
                maxLength={300}
                onChange={event => setDescription(event.target.value)}
                placeholder="What this role is for"
                className="bg-background"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {grouped.map(group => (
              <fieldset
                key={group.group}
                className="space-y-2 rounded-lg border border-border bg-background p-3"
              >
                <legend className="sr-only">{group.label}</legend>
                <p
                  aria-hidden
                  className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {group.label}
                </p>
                {group.items.map(capability => {
                  const checkboxId = `custom-role-cap-${capability}`;
                  return (
                    <div key={capability} className="flex items-start gap-2.5">
                      <Checkbox
                        id={checkboxId}
                        className="mt-0.5"
                        checked={selected.has(capability)}
                        onCheckedChange={checked =>
                          setSelected(current => {
                            const next = new Set(current);
                            if (checked === true) next.add(capability);
                            else next.delete(capability);
                            return next;
                          })
                        }
                      />
                      <label
                        htmlFor={checkboxId}
                        className="flex flex-1 cursor-pointer flex-wrap items-center gap-1.5 text-sm leading-snug text-foreground"
                      >
                        {capabilityInfo(capability).label}
                        {capabilityInfo(capability).risk === 'high' && (
                          <StatusPill tone="danger">High risk</StatusPill>
                        )}
                      </label>
                    </div>
                  );
                })}
              </fieldset>
            ))}
          </div>
          <FormFooter
            feedback={
              <span className="text-xs text-muted-foreground">
                {selected.size} permission{selected.size === 1 ? '' : 's'} selected
              </span>
            }
          >
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              disabled={pending || name.trim().length < 2 || selected.size === 0}
              onClick={() =>
                startTransition(async () => {
                  const outcome = await saveCustomRoleAction({
                    id: editing.id || null,
                    name,
                    description,
                    capabilities: [...selected],
                  });
                  setResult(outcome);
                  if (outcome.ok) {
                    setEditing(null);
                    router.refresh();
                  }
                })
              }
            >
              {pending ? 'Saving…' : 'Save role'}
            </Button>
          </FormFooter>
        </div>
      )}

      {roles.length > 0 && (
        <div className="space-y-4 rounded-lg border border-border p-4 md:p-5">
          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-foreground">Assign a custom role</h4>
            <p className="text-xs text-muted-foreground">
              Each person can hold one custom role. Assigning replaces their current one.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="assign-person">Person</Label>
              <SimpleSelect
                id="assign-person"
                value={assignUser}
                onValueChange={setAssignUser}
                options={users.map(user => ({
                  value: user.id,
                  label: `${userLabel(user)}${
                    assignedName(user.id) ? ` (has ${assignedName(user.id)})` : ''
                  }`,
                }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="assign-role">Custom role</Label>
              <SimpleSelect
                id="assign-role"
                value={assignRole}
                onValueChange={setAssignRole}
                options={roles.map(role => ({ value: role.id, label: role.name }))}
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={pending || !assignedRoleFor(assignUser)}
                onClick={() =>
                  startTransition(async () => {
                    const outcome = await assignCustomRoleAction(assignUser, null);
                    setResult(outcome);
                    if (outcome.ok) router.refresh();
                  })
                }
              >
                Remove from person
              </Button>
              <Button
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const outcome = await assignCustomRoleAction(assignUser, assignRole);
                    setResult(outcome);
                    if (outcome.ok) router.refresh();
                  })
                }
              >
                Assign
              </Button>
            </div>
          </div>
        </div>
      )}
      <Feedback result={result} />
    </div>
  );
}

// ─── Access reviews ─────────────────────────────────────────────────────────

type ReviewItemView = {
  id: string;
  userId: string;
  subjectType: string;
  subjectLabel: string;
  decision: 'PENDING' | 'KEEP' | 'REVOKE';
  note: string | null;
};

export function StartAccessReviewForm() {
  const router = useRouter();
  const [name, setName] = useState(`Access review ${new Date().toISOString().slice(0, 10)}`);
  const [due, setDue] = useState('14');
  const [result, setResult] = useState<Parameters<typeof Feedback>[0]['result']>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-dashed border-border p-4">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ClipboardCheck className="h-4 w-4" aria-hidden />
        </span>
        <div className="space-y-0.5">
          <p className="text-sm font-semibold text-foreground">No review in progress</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Starting a review lists everyone with elevated access. Reviewers keep or remove each
            one, and an administrator applies the removals.
          </p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="review-name">Review name</Label>
          <Input
            id="review-name"
            value={name}
            maxLength={120}
            onChange={event => setName(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="review-due">Due in</Label>
          <SimpleSelect
            id="review-due"
            value={due}
            onValueChange={setDue}
            options={[
              { value: '7', label: '7 days' },
              { value: '14', label: '14 days' },
              { value: '30', label: '30 days' },
            ]}
          />
        </div>
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const outcome = await startAccessReviewAction({ name, dueInDays: Number(due) });
              setResult(outcome);
              if (outcome.ok) router.refresh();
            })
          }
        >
          {pending ? 'Starting…' : 'Start review'}
        </Button>
      </div>
      <Feedback result={result} />
    </div>
  );
}

export function AccessReviewItems({
  reviewId,
  items,
  currentUserId,
  canSelfCertify,
  canComplete,
}: {
  reviewId: string;
  items: ReviewItemView[];
  currentUserId: string;
  /** Sole reviewer (or policy allows): own items can be decided and are flagged as such. */
  canSelfCertify: boolean;
  /** Applying removals changes roles, so only administrators complete reviews. */
  canComplete: boolean;
}) {
  const router = useRouter();
  const [result, setResult] = useState<Parameters<typeof Feedback>[0]['result']>(null);
  const [pending, startTransition] = useTransition();
  const remaining = items.filter(item => item.decision === 'PENDING').length;
  const [confirmCancel, setConfirmCancel] = useState(false);

  const decide = (itemId: string, decision: 'KEEP' | 'REVOKE') =>
    startTransition(async () => {
      const outcome = await decideAccessReviewItemAction(itemId, decision);
      if (!outcome.ok) setResult(outcome);
      router.refresh();
    });

  const decided = items.length - remaining;
  const percent = items.length === 0 ? 100 : Math.round((decided / items.length) * 100);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground">{decided}</span> of {items.length}{' '}
            decided
          </span>
          <span>{remaining > 0 ? `${remaining} still need a decision` : 'All items decided'}</span>
        </div>
        <div
          role="progressbar"
          aria-label="Review progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {items.map(item => (
          <li
            key={item.id}
            className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium text-foreground">{item.subjectLabel}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusPill tone="neutral">
                  {item.subjectType.replace('_', ' ').toLowerCase()}
                </StatusPill>
                {item.decision === 'KEEP' && <StatusPill tone="success">Keep</StatusPill>}
                {item.decision === 'REVOKE' && <StatusPill tone="danger">Remove</StatusPill>}
              </div>
            </div>
            {item.userId === currentUserId && !canSelfCertify ? (
              <span className="text-xs text-muted-foreground">Another reviewer must decide</span>
            ) : (
              <div
                role="group"
                aria-label={`Decision for ${item.subjectLabel}`}
                className="inline-flex shrink-0 rounded-md border border-border p-0.5"
              >
                <Button
                  size="sm"
                  variant={item.decision === 'KEEP' ? 'default' : 'ghost'}
                  aria-pressed={item.decision === 'KEEP'}
                  disabled={pending}
                  className="h-7"
                  onClick={() => decide(item.id, 'KEEP')}
                >
                  Keep
                </Button>
                <Button
                  size="sm"
                  variant={item.decision === 'REVOKE' ? 'destructive' : 'ghost'}
                  aria-pressed={item.decision === 'REVOKE'}
                  disabled={pending}
                  className="h-7"
                  onClick={() => decide(item.id, 'REVOKE')}
                >
                  Remove
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <FormFooter
        feedback={
          <a
            href={`/api/access/reviews/${reviewId}/export`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            Download evidence (JSON)
          </a>
        }
      >
        <Button
          variant={confirmCancel ? 'destructive' : 'ghost'}
          disabled={pending}
          onClick={() => {
            if (!confirmCancel) {
              setConfirmCancel(true);
              return;
            }
            startTransition(async () => {
              const outcome = await cancelAccessReviewAction(reviewId);
              setConfirmCancel(false);
              setResult(outcome);
              if (outcome.ok) router.refresh();
            });
          }}
          onBlur={() => setConfirmCancel(false)}
        >
          {confirmCancel ? 'Confirm: cancel without changes' : 'Cancel review'}
        </Button>
        {canComplete ? (
          <Button
            disabled={pending || remaining > 0}
            onClick={() =>
              startTransition(async () => {
                const outcome = await completeAccessReviewAction(reviewId);
                setResult(outcome);
                if (outcome.ok) router.refresh();
              })
            }
          >
            Complete review and apply removals
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">
            An administrator completes the review and applies removals.
          </span>
        )}
      </FormFooter>
      <Feedback result={result} />
    </div>
  );
}
