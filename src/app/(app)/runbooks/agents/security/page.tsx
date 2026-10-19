import { Archive, Fingerprint, Gauge, ShieldCheck } from 'lucide-react';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability, getCurrentUser, getUserPermissions } from '@/lib/rbac';
import { getRunbookNavigationSummary } from '@/lib/runbooks/presentation/summaries';
import { formatDateTime, getUserTimeZone } from '@/lib/timezone';
import { FleetPageShell } from '@/components/runbooks/agents/FleetPageShell';
import { ActionForm, SubmitButton } from '@/components/runbooks/RunbookControls';
import { RunbookStatusBadge } from '@/components/runbooks/RunbookStatusBadge';
import { EmptyHint, Pill, SectionCard } from '@/components/runbooks/ui/primitives';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import {
  rotateExecutionSigningIdentityAction,
  updateIncidentRemediationBudgetAction,
  updateRunbookArtifactRetentionAction,
} from '../../actions';

export const revalidate = 0;

export default async function RunbookFleetSecurityPage() {
  await assertCapability(CAPABILITIES.RUNBOOK_READ_ALL);
  const [permissions, user, navigation] = await Promise.all([
    getUserPermissions(),
    getCurrentUser(),
    getRunbookNavigationSummary(),
  ]);
  const userTimeZone = getUserTimeZone(user);
  const capabilities = permissions.capabilities;
  const canManage = capabilities.includes(CAPABILITIES.RUNBOOK_AGENT_MANAGE);
  const canManageSecrets = capabilities.includes(CAPABILITIES.RUNBOOK_SECRET_MANAGE);
  const canManageBudgets = capabilities.includes(CAPABILITIES.RUNBOOK_MANAGE);
  const canManageRetention = capabilities.includes(CAPABILITIES.ADMIN_MANAGE);

  const [settings, signingKeys] = await Promise.all([
    canManageBudgets || canManageRetention
      ? prisma.systemSettings.findUnique({
          where: { id: 'default' },
          select: {
            runbookAutoExecutionsPerIncident: true,
            runbookAutoWritesPerIncident: true,
            runbookAutoNonIdempotentPerIncident: true,
            runbookArtifactRetentionDays: true,
          },
        })
      : Promise.resolve(null),
    canManage
      ? prisma.runbookExecutionSigningKey.findMany({
          where: { state: { not: 'RETIRED' } },
          select: { id: true, publicKey: true, state: true, retiredAt: true },
          orderBy: { createdAt: 'asc' },
        })
      : Promise.resolve([]),
  ]);
  const activeKey = signingKeys.find(key => key.state === 'ACTIVE');
  const defaultRetention = Math.min(
    3650,
    Math.max(1, Number.parseInt(process.env.RUNBOOK_ARTIFACT_RETENTION_DAYS ?? '30', 10) || 30)
  );
  const nothingVisible = !canManage && !canManageBudgets && !canManageRetention;

  return (
    <FleetPageShell
      title="Fleet Security"
      section="Security"
      icon={ShieldCheck}
      description="Execution signing identity, automatic remediation limits and evidence retention for every Agent in the fleet."
      navigation={navigation}
      canManageSecrets={canManageSecrets}
    >
      {nothingVisible && (
        <EmptyHint
          icon={ShieldCheck}
          title="No security settings available"
          description="Your role can view the fleet but cannot change signing, remediation or retention policies."
          className="bg-card"
        />
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        {canManage && (
          <SectionCard
            icon={Fingerprint}
            title="Execution signing identity"
            description="OpsKnight signs every dispatched step. Agents reject work that is not signed by a key they trust, so rotate by staging a NEXT key, distributing it to every Agent, then activating it."
            className="lg:col-span-2"
            bodyClassName="space-y-5 text-sm"
          >
            {activeKey ? (
              <section aria-labelledby="pinned-key-title" className="space-y-2">
                <h3 id="pinned-key-title" className="!text-sm !leading-snug font-semibold">
                  Pinned execution public key
                </h3>
                <p className="text-xs text-muted-foreground">
                  Set OPSKNIGHT_EXECUTION_PUBLIC_KEY on every Agent. Verify the value through your
                  trusted OpsKnight session.
                </p>
                <code className="block rounded-xl border border-border/80 dark:border-border/60 bg-muted/40 p-3.5 font-mono text-xs break-all select-all">
                  {activeKey.publicKey}
                </code>
              </section>
            ) : (
              <p className="rounded-xl border border-dashed border-border/80 p-4 text-xs text-muted-foreground">
                No active execution signing key is available yet.
              </p>
            )}
            {activeKey && (
              <section
                aria-labelledby="key-rotation-title"
                className="space-y-3 border-t border-border/60 pt-4"
              >
                <h3 id="key-rotation-title" className="!text-sm !leading-snug font-semibold">
                  Overlapping rotation
                </h3>
                <ol className="grid gap-2.5 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    'Stage the next signing identity.',
                    'Set OPSKNIGHT_EXECUTION_PUBLIC_KEYS to the trusted key map below on every Agent, including offline Agents.',
                    'Wait for fleet acknowledgement, then activate NEXT.',
                    'RETIRING keys keep a 24-hour grace period before they can be retired.',
                  ].map((step, index) => (
                    <li
                      key={index}
                      className="flex gap-2.5 rounded-xl border border-border/80 dark:border-border/60 bg-muted/30 p-3.5"
                    >
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary tabular-nums">
                        {index + 1}
                      </span>
                      <span className="leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ol>
                <code className="block rounded-xl border border-border/80 dark:border-border/60 bg-muted/40 p-3.5 font-mono text-xs break-all">
                  {JSON.stringify(
                    Object.fromEntries(signingKeys.map(key => [key.id, key.publicKey]))
                  )}
                </code>
                <ActionForm action={rotateExecutionSigningIdentityAction}>
                  <input type="hidden" name="operation" value="stage" />
                  <SubmitButton
                    variant="outline"
                    disabled={signingKeys.some(key => key.state === 'NEXT')}
                  >
                    Stage next signing identity
                  </SubmitButton>
                </ActionForm>
                {signingKeys
                  .filter(key => key.state !== 'ACTIVE')
                  .map(key => (
                    <ActionForm
                      key={key.id}
                      action={rotateExecutionSigningIdentityAction}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs p-3.5 shadow-xs"
                    >
                      <input
                        type="hidden"
                        name="operation"
                        value={key.state === 'NEXT' ? 'activate' : 'retire'}
                      />
                      <input type="hidden" name="keyId" value={key.id} />
                      <div className="min-w-0 space-y-1 text-xs">
                        <div className="flex items-center gap-2">
                          <RunbookStatusBadge status={key.state} size="sm" />
                          <span className="font-mono break-all">{key.id}</span>
                        </div>
                        {key.state === 'RETIRING' && key.retiredAt && (
                          <p className="text-muted-foreground">
                            Grace ends{' '}
                            {formatDateTime(key.retiredAt, userTimeZone, {
                              format: 'datetime',
                              includeTimeZone: true,
                            })}
                          </p>
                        )}
                      </div>
                      <SubmitButton size="sm">
                        {key.state === 'NEXT'
                          ? 'Activate acknowledged identity'
                          : 'Retire after grace period'}
                      </SubmitButton>
                    </ActionForm>
                  ))}
              </section>
            )}
          </SectionCard>
        )}

        {canManageBudgets && (
          <SectionCard
            icon={Gauge}
            title="Automatic remediation budgets"
            description="Upper bounds on what incident-triggered automation may do on its own for a single incident. Once a budget is exhausted, further runs require an operator."
          >
            <ActionForm action={updateIncidentRemediationBudgetAction} className="space-y-4">
              <Field label="Automatic executions per incident">
                <Input
                  name="executions"
                  aria-label="Automatic executions per incident"
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={settings?.runbookAutoExecutionsPerIncident ?? 3}
                />
              </Field>
              <Field label="Automatic writes per incident">
                <Input
                  name="writes"
                  aria-label="Automatic writes per incident"
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={settings?.runbookAutoWritesPerIncident ?? 3}
                />
              </Field>
              <Field label="Automatic non-idempotent actions per incident">
                <Input
                  name="nonIdempotent"
                  aria-label="Automatic non-idempotent actions per incident"
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={settings?.runbookAutoNonIdempotentPerIncident ?? 0}
                />
              </Field>
              <p className="rounded-lg bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                Non-idempotent actions are not safe to repeat; keep this at 0 unless every such step
                has been reviewed for automatic use.
              </p>
              <SubmitButton>Save remediation budgets</SubmitButton>
            </ActionForm>
          </SectionCard>
        )}

        {canManageRetention && (
          <SectionCard
            icon={Archive}
            tone="danger"
            title={
              <span className="flex items-center gap-2">
                Execution artifact retention
                <Pill tone="danger">Destructive</Pill>
              </span>
            }
            description="How long step output and evidence artifacts are kept before reconciliation deletes them."
          >
            <ActionForm action={updateRunbookArtifactRetentionAction} className="space-y-4">
              <Field label="Artifact retention days">
                <Input
                  name="days"
                  type="number"
                  min={1}
                  max={3650}
                  required
                  defaultValue={settings?.runbookArtifactRetentionDays ?? defaultRetention}
                />
              </Field>
              <p className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs leading-relaxed text-destructive">
                The next reconciliation permanently deletes artifact contents older than this
                policy. Execution records remain, but deleted output cannot be recovered. Export
                evidence before shortening retention.
              </p>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="confirm"
                  required
                  className="mt-0.5 h-4 w-4 shrink-0 accent-destructive"
                />
                I understand this policy permanently deletes expired evidence.
              </label>
              <SubmitButton variant="destructive">Save artifact retention policy</SubmitButton>
            </ActionForm>
          </SectionCard>
        )}
      </div>
    </FleetPageShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
