import {
  Archive,
  Fingerprint,
  Gauge,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Activity,
  Key,
  Sliders,
  AlertCircle,
} from 'lucide-react';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability, getCurrentUser, getUserPermissions } from '@/lib/rbac';
import { getRunbookNavigationSummary } from '@/lib/runbooks/presentation/summaries';
import { formatDateTime, getUserTimeZone } from '@/lib/timezone';
import { FleetPageShell } from '@/components/runbooks/agents/FleetPageShell';
import { ActionForm, SubmitButton } from '@/components/runbooks/RunbookControls';
import { EmptyHint, Pill, SectionCard } from '@/components/runbooks/ui/primitives';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import {
  rotateExecutionSigningIdentityAction,
  updateIncidentRemediationBudgetAction,
  updateRunbookArtifactRetentionAction,
} from '../../actions';
import {
  ActiveKeyBox,
  MultiKeyMapBox,
  RotationStepper,
  SigningKeyList,
  ArtifactRetentionForm,
} from '@/components/runbooks/agents/FleetSecurityControls';

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
          select: { id: true, publicKey: true, state: true, retiredAt: true, createdAt: true },
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

  const keyMapJson = JSON.stringify(
    Object.fromEntries(signingKeys.map(key => [key.id, key.publicKey])),
    null,
    2
  );

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

      <div className="space-y-6">
        {/* Card 1: Execution Signing Identity */}
        {canManage && (
          <SectionCard
            icon={Fingerprint}
            title={
              <div className="flex items-center gap-2">
                <span>Execution Signing Identity</span>
                <span className="rounded-full bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                  Cryptographically Enforced
                </span>
              </div>
            }
            description="OpsKnight signs every dispatched step. Agents verify ECDSA/ED25519 signatures before claiming work, ensuring tampered or unauthorized runs are rejected."
            bodyClassName="space-y-6 p-5 sm:p-6"
          >
            {activeKey ? (
              <ActiveKeyBox
                publicKey={activeKey.publicKey}
                keyId={activeKey.id}
                activeSince={formatDateTime(activeKey.createdAt, userTimeZone, {
                  format: 'datetime',
                  includeTimeZone: true,
                })}
              />
            ) : (
              <div className="rounded-2xl border border-dashed border-border/80 p-5 text-center text-xs text-muted-foreground">
                No active execution signing key is configured yet.
              </div>
            )}

            {activeKey && (
              <div className="space-y-4 border-t border-border/60 pt-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-foreground">
                      Zero-Downtime Rotation Protocol
                    </h3>
                    <p className="text-[11px] text-muted-foreground">
                      Rotate keys seamlessly across large, multi-environment agent fleets without
                      interrupting running workloads.
                    </p>
                  </div>
                </div>

                <RotationStepper />

                <MultiKeyMapBox keyMapJson={keyMapJson} keyCount={signingKeys.length} />

                <SigningKeyList
                  signingKeys={signingKeys}
                  userTimeZone={userTimeZone}
                  rotateAction={rotateExecutionSigningIdentityAction}
                />
              </div>
            )}
          </SectionCard>
        )}

        {/* Two-Column Grid for Budgets & Retention */}
        {(canManageBudgets || canManageRetention) && (
          <div className="grid gap-6 lg:grid-cols-2 items-stretch">
            {/* Card 2: Incident Remediation Budgets */}
            {canManageBudgets && (
              <SectionCard
                icon={Gauge}
                title={
                  <div className="flex items-center gap-2">
                    <span>Remediation Safeguards & Budgets</span>
                    <span className="rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      Circuit Breaker
                    </span>
                  </div>
                }
                description="Ceilings on autonomous remediation actions executed during an active incident. Once exhausted, automation halts until approved by an operator."
                className="flex flex-col h-full"
                bodyClassName="flex flex-col justify-between flex-1 p-5 sm:p-6"
              >
                <ActionForm
                  action={updateIncidentRemediationBudgetAction}
                  className="flex flex-col justify-between h-full space-y-4"
                >
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <BudgetTile
                        label="Executions Limit"
                        hint="Max automated runs"
                        name="executions"
                        defaultValue={settings?.runbookAutoExecutionsPerIncident ?? 3}
                        min={0}
                        max={100}
                      />
                      <BudgetTile
                        label="State Writes"
                        hint="Max mutating steps"
                        name="writes"
                        defaultValue={settings?.runbookAutoWritesPerIncident ?? 3}
                        min={0}
                        max={100}
                      />
                      <BudgetTile
                        label="Non-Idempotent"
                        hint="Zero (0) recommended"
                        name="nonIdempotent"
                        defaultValue={settings?.runbookAutoNonIdempotentPerIncident ?? 0}
                        min={0}
                        max={100}
                        highlightZero
                      />
                    </div>

                    <div className="flex items-start gap-2.5 rounded-xl border border-border/70 dark:border-border/50 bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground">
                      <ShieldCheck className="h-4 w-4 shrink-0 text-primary mt-0.5" />
                      <p className="text-[11px] leading-relaxed">
                        These limits act as an automatic circuit breaker against runaway remediation
                        loops. When any ceiling is reached, further dispatches transition to{' '}
                        <strong className="text-foreground">WAITING_APPROVAL</strong>.
                      </p>
                    </div>
                  </div>

                  <div className="pt-2">
                    <SubmitButton className="w-full h-9 text-xs font-semibold rounded-xl shadow-xs cursor-pointer">
                      Save Remediation Budgets
                    </SubmitButton>
                  </div>
                </ActionForm>
              </SectionCard>
            )}

            {/* Card 3: Artifact Retention Policy */}
            {canManageRetention && (
              <SectionCard
                icon={Archive}
                tone="danger"
                title={
                  <div className="flex items-center gap-2">
                    <span>Evidence & Artifact Retention</span>
                    <Pill tone="danger">Destructive Policy</Pill>
                  </div>
                }
                description="Controls how long step output logs and execution evidence artifacts are retained before reconciliation permanently purges them."
                className="flex flex-col h-full"
                bodyClassName="flex flex-col justify-between flex-1 p-5 sm:p-6"
              >
                <ArtifactRetentionForm
                  defaultDays={settings?.runbookArtifactRetentionDays ?? defaultRetention}
                  action={updateRunbookArtifactRetentionAction}
                />
              </SectionCard>
            )}
          </div>
        )}
      </div>
    </FleetPageShell>
  );
}

function BudgetTile({
  label,
  hint,
  name,
  defaultValue,
  min,
  max,
  highlightZero = false,
}: {
  label: string;
  hint: string;
  name: string;
  defaultValue: number;
  min: number;
  max: number;
  highlightZero?: boolean;
}) {
  return (
    <div className="flex flex-col justify-between rounded-xl border border-border/80 dark:border-border/60 bg-muted/20 p-3 space-y-2">
      <div>
        <Label htmlFor={name} className="text-[11px] font-bold text-foreground">
          {label}
        </Label>
        <p className="text-[10px] text-muted-foreground truncate">{hint}</p>
      </div>

      <div className="relative">
        <Input
          id={name}
          name={name}
          type="number"
          min={min}
          max={max}
          defaultValue={defaultValue}
          className="h-8 font-semibold tabular-nums text-xs rounded-lg border-border/80 bg-background/80"
        />
      </div>
    </div>
  );
}
