'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, CircleSlash, Info, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Switch } from '@/components/ui/shadcn/switch';
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
const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

type UserOption = { id: string; name: string | null; email: string; role: string };

function Feedback({
  result,
}: {
  result: { ok: boolean; message?: string; error?: string; code?: string } | null;
}) {
  if (!result) return null;
  if (result.ok) {
    return result.message ? (
      <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
        {result.message}
      </p>
    ) : null;
  }
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-2 text-sm text-rose-600 dark:text-rose-400"
    >
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
    <div className="space-y-4">
      {toggles.map(toggle => (
        <div key={toggle.key} className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor={`policy-${toggle.key}`} className="font-medium">
              {toggle.label}
            </Label>
            <p className="text-xs text-muted-foreground">{toggle.help}</p>
          </div>
          <Switch
            id={`policy-${toggle.key}`}
            checked={Boolean(values[toggle.key])}
            onCheckedChange={checked => set(toggle.key, checked as never)}
          />
        </div>
      ))}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="policy-break-glass-max">Longest emergency access</Label>
          <select
            id="policy-break-glass-max"
            className={selectClass}
            value={values.breakGlassMaxMinutes}
            onChange={event => set('breakGlassMaxMinutes', Number(event.target.value))}
          >
            {[15, 30, 60, 120, 240].map(minutes => (
              <option key={minutes} value={minutes}>
                {minutes < 60
                  ? `${minutes} minutes`
                  : `${minutes / 60} hour${minutes === 60 ? '' : 's'}`}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="policy-review-interval">Automatic access reviews</Label>
          <select
            id="policy-review-interval"
            className={selectClass}
            value={values.reviewIntervalDays ?? ''}
            onChange={event =>
              set('reviewIntervalDays', event.target.value ? Number(event.target.value) : null)
            }
          >
            <option value="">Off</option>
            <option value="30">Monthly</option>
            <option value="90">Quarterly</option>
            <option value="180">Twice a year</option>
            <option value="365">Yearly</option>
          </select>
        </div>
      </div>
      <div className="flex items-center gap-3">
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
        <Feedback result={result} />
      </div>
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
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="check-user">Person</Label>
          <select
            id="check-user"
            className={selectClass}
            value={userId}
            onChange={event => setUserId(event.target.value)}
          >
            {users.map(user => (
              <option key={user.id} value={user.id}>
                {userLabel(user)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="check-kind">Check</Label>
          <select
            id="check-kind"
            className={selectClass}
            value={kind}
            onChange={event => setKind(event.target.value as typeof kind)}
          >
            <option value="page">Opening a page</option>
            <option value="incident">An action on an incident</option>
            <option value="capability">A permission</option>
          </select>
        </div>
        {kind === 'page' && (
          <div className="space-y-1.5">
            <Label htmlFor="check-path">Page path</Label>
            <Input
              id="check-path"
              value={path}
              onChange={event => setPath(event.target.value)}
              placeholder="/runbooks"
            />
          </div>
        )}
        {kind === 'capability' && (
          <div className="space-y-1.5">
            <Label htmlFor="check-capability">Permission</Label>
            <select
              id="check-capability"
              className={selectClass}
              value={capability}
              onChange={event => setCapability(event.target.value as Capability)}
            >
              {ALL_CATALOGUED_CAPABILITIES.map(option => (
                <option key={option} value={option}>
                  {capabilityInfo(option).label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {kind === 'incident' && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="check-incident">Incident ID or link</Label>
            <Input
              id="check-incident"
              value={incidentId}
              onChange={event => setIncidentId(event.target.value)}
              placeholder="https://…/incidents/clx…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="check-action">Action</Label>
            <select
              id="check-action"
              className={selectClass}
              value={action}
              onChange={event => setAction(event.target.value as typeof action)}
            >
              <option value="view">View</option>
              <option value="acknowledge">Acknowledge</option>
              <option value="note">Add a note</option>
              <option value="escalate">Escalate</option>
              <option value="resolve">Resolve</option>
              <option value="manage">Change urgency, reassign, snooze…</option>
            </select>
          </div>
        </div>
      )}
      <Button onClick={run} disabled={pending || !userId}>
        {pending ? 'Checking…' : 'Check access'}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-rose-600">
          {error}
        </p>
      )}
      {result && (
        <div
          role="status"
          className={cn(
            'rounded-lg border p-4',
            result.allowed
              ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/50 dark:bg-emerald-950/20'
              : 'border-rose-200 bg-rose-50/60 dark:border-rose-900/50 dark:bg-rose-950/20'
          )}
        >
          <p className="mb-3 flex items-center gap-2 font-semibold">
            {result.allowed ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
            ) : (
              <XCircle className="h-4 w-4 text-rose-600" aria-hidden />
            )}
            {result.summary}
          </p>
          <ol className="space-y-1.5 text-sm">
            {result.steps.map((step, index) => (
              <li key={index} className="flex gap-2">
                {step.outcome === 'pass' ? (
                  <CheckCircle2
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600"
                    aria-label="Pass"
                  />
                ) : step.outcome === 'fail' ? (
                  <CircleSlash
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600"
                    aria-label="Fail"
                  />
                ) : (
                  <Info
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    aria-label="Info"
                  />
                )}
                <span>
                  <strong>{step.label}:</strong> {step.detail}
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
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[16rem] flex-1 space-y-1.5">
          <Label htmlFor="who-capability">Permission</Label>
          <select
            id="who-capability"
            className={selectClass}
            value={capability}
            onChange={event => setCapability(event.target.value as Capability)}
          >
            {ALL_CATALOGUED_CAPABILITIES.map(option => (
              <option key={option} value={option}>
                {capabilityInfo(option).label}
              </option>
            ))}
          </select>
        </div>
        <Button
          disabled={pending}
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
          {pending ? 'Looking…' : 'Show people'}
        </Button>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {data && (
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            Built-in roles with this permission:{' '}
            {data.roles.length ? data.roles.map(role => roleLabel(role)).join(', ') : 'none'}.
          </p>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {data.byRole.map(user => (
              <li key={`r-${user.id}`} className="flex justify-between gap-2 px-3 py-1.5">
                <span>{user.name ?? user.email}</span>
                <span className="text-xs text-muted-foreground">
                  role: {roleLabel(user.role as AppRole)}
                </span>
              </li>
            ))}
            {data.byCustomRole.map(user => (
              <li key={`c-${user.id}`} className="flex justify-between gap-2 px-3 py-1.5">
                <span>{user.name ?? user.email}</span>
                <span className="text-xs text-muted-foreground">
                  custom role: {user.customRole}
                </span>
              </li>
            ))}
            {data.byGrant.map(grant => (
              <li key={`g-${grant.id}`} className="flex justify-between gap-2 px-3 py-1.5">
                <span>{grant.user.name ?? grant.user.email}</span>
                <span className="text-xs text-muted-foreground">
                  temporary {roleLabel(grant.role as AppRole)} until{' '}
                  {new Date(grant.expiresAt).toLocaleString()}
                </span>
              </li>
            ))}
            {data.byRole.length + data.byCustomRole.length + data.byGrant.length === 0 && (
              <li className="px-3 py-2 text-muted-foreground">Nobody.</li>
            )}
          </ul>
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

  return (
    <div className="space-y-5">
      <ul className="divide-y divide-border rounded-lg border border-border text-sm">
        {roles.length === 0 && (
          <li className="px-3 py-3 text-muted-foreground">
            No custom roles yet. Create one to give specific people extra permissions without making
            them Responders or Admins.
          </li>
        )}
        {roles.map(role => (
          <li key={role.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
            <span className="flex-1">
              <strong>{role.name}</strong>
              <span className="block text-xs text-muted-foreground">
                {role.capabilities.length} permission{role.capabilities.length === 1 ? '' : 's'} ·{' '}
                {role.holders} {role.holders === 1 ? 'person' : 'people'}
                {role.description ? ` · ${role.description}` : ''}
              </span>
            </span>
            <Button size="sm" variant="outline" onClick={() => edit(role)}>
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const outcome = await archiveCustomRoleAction(role.id);
                  setResult(outcome);
                  if (outcome.ok) router.refresh();
                })
              }
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      {!editing && <Button onClick={() => edit(null)}>New custom role</Button>}

      {editing && (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="custom-role-name">Name</Label>
              <Input
                id="custom-role-name"
                value={name}
                maxLength={60}
                onChange={event => setName(event.target.value)}
                placeholder="Runbook operator"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="custom-role-description">Description</Label>
              <Input
                id="custom-role-description"
                value={description}
                maxLength={300}
                onChange={event => setDescription(event.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            These permissions are added on top of each holder’s built-in role. Organization
            administration can only be granted with the Admin role.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {grouped.map(group => (
              <fieldset key={group.group}>
                <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </legend>
                {group.items.map(capability => (
                  <label key={capability} className="flex items-center gap-2 py-0.5 text-sm">
                    <input
                      type="checkbox"
                      checked={selected.has(capability)}
                      onChange={event =>
                        setSelected(current => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(capability);
                          else next.delete(capability);
                          return next;
                        })
                      }
                    />
                    <span className="flex-1">{capabilityInfo(capability).label}</span>
                    {capabilityInfo(capability).risk === 'high' && (
                      <span className="rounded bg-rose-100 px-1.5 text-[10px] font-semibold uppercase text-rose-800 dark:bg-rose-900/40 dark:text-rose-200">
                        High risk
                      </span>
                    )}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {roles.length > 0 && (
        <div className="space-y-2 rounded-lg border border-border p-4">
          <h4 className="text-sm font-semibold">Assign a custom role</h4>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
            <select
              aria-label="Person"
              className={selectClass}
              value={assignUser}
              onChange={event => setAssignUser(event.target.value)}
            >
              {users.map(user => (
                <option key={user.id} value={user.id}>
                  {userLabel(user)}
                  {assignedRoleFor(user.id)
                    ? ` (has ${roles.find(role => role.id === assignedRoleFor(user.id))?.name ?? 'a custom role'})`
                    : ''}
                </option>
              ))}
            </select>
            <select
              aria-label="Custom role"
              className={selectClass}
              value={assignRole}
              onChange={event => setAssignRole(event.target.value)}
            >
              {roles.map(role => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
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
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-[14rem] flex-1 space-y-1.5">
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
        <select
          id="review-due"
          className={selectClass}
          value={due}
          onChange={event => setDue(event.target.value)}
        >
          <option value="7">7 days</option>
          <option value="14">14 days</option>
          <option value="30">30 days</option>
        </select>
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

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border rounded-lg border border-border text-sm">
        {items.map(item => (
          <li key={item.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <span className="flex-1">
              {item.subjectLabel}
              <span className="block text-[11px] uppercase text-muted-foreground">
                {item.subjectType.replace('_', ' ').toLowerCase()}
              </span>
            </span>
            {item.userId === currentUserId && !canSelfCertify ? (
              <span className="text-xs text-muted-foreground">Another reviewer must decide</span>
            ) : (
              <>
                <Button
                  size="sm"
                  variant={item.decision === 'KEEP' ? 'default' : 'outline'}
                  disabled={pending}
                  onClick={() => decide(item.id, 'KEEP')}
                >
                  Keep
                </Button>
                <Button
                  size="sm"
                  variant={item.decision === 'REVOKE' ? 'destructive' : 'outline'}
                  disabled={pending}
                  onClick={() => decide(item.id, 'REVOKE')}
                >
                  Remove
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
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
        <span className="text-xs text-muted-foreground">
          {remaining > 0 ? `${remaining} still need a decision` : 'All items decided'}
        </span>
        <a
          href={`/api/access/reviews/${reviewId}/export`}
          className="text-sm text-primary hover:underline"
        >
          Download evidence (JSON)
        </a>
      </div>
      <Feedback result={result} />
    </div>
  );
}
