import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { BookOpen, Link2, Settings2, Trash2 } from 'lucide-react';
import {
  attachRunbookAction,
  detachRunbookAction,
  updateRunbookBindingAction,
  configureRunbookTriggerAction,
} from '@/app/(app)/services/[id]/runbook-actions';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';

type Binding = Prisma.ServiceRunbookBindingGetPayload<{
  include: { runbook: true; runbookVersion: true; triggers: { include: { conditions: true } } };
}>;

type AvailableRunbook = Prisma.RunbookGetPayload<{
  include: { publishedVersion: { include: { inputs: true } }; versions: true };
}>;

export default function ServiceRunbooks({
  serviceId,
  bindings,
  availableRunbooks,
  availableAgents,
  availableAgentPools,
  canManage,
}: {
  serviceId: string;
  bindings: Binding[];
  availableRunbooks: AvailableRunbook[];
  availableAgents: Array<{ id: string; name: string; hostname: string | null }>;
  availableAgentPools: Array<{ id: string; name: string; mode: string }>;
  canManage: boolean;
}) {
  const unattached = availableRunbooks.filter(
    runbook => !bindings.some(binding => binding.runbookId === runbook.id)
  );
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Service runbooks</h2>
          <p className="text-sm text-muted-foreground">
            Attach reusable published workflows with service-specific inputs and execution policy.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/runbooks">
            <BookOpen /> Library
          </Link>
        </Button>
      </div>
      {bindings.map(binding => (
        <Card key={binding.id}>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">
                  <Link href={`/runbooks/${binding.runbookId}`} className="hover:underline">
                    {binding.runbook.name}
                  </Link>
                </CardTitle>
                <CardDescription>{binding.runbook.description}</CardDescription>
              </div>
              <div className="flex gap-2">
                <Badge variant={binding.enabled ? 'default' : 'secondary'}>
                  {binding.enabled ? binding.mode : 'DISABLED'}
                </Badge>
                <Badge variant="outline">
                  {binding.versionStrategy === 'PINNED'
                    ? `v${binding.runbookVersion?.version ?? '?'}`
                    : 'Latest published'}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {canManage ? (
              <form
                action={updateRunbookBindingAction.bind(null, serviceId, binding.id)}
                className="grid gap-3 lg:grid-cols-4"
              >
                <Field label="Mode">
                  <select
                    name="mode"
                    defaultValue={binding.mode}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="MANUAL">Manual</option>
                    <option value="SUGGESTED">Suggested</option>
                    <option value="AUTOMATIC">Automatic</option>
                  </select>
                </Field>
                <Field label="Version strategy">
                  <select
                    name="versionStrategy"
                    defaultValue={binding.versionStrategy}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="LATEST_PUBLISHED">Latest published</option>
                    <option value="PINNED">Pinned</option>
                  </select>
                </Field>
                <Field label="Pinned version">
                  <select
                    name="runbookVersionId"
                    defaultValue={
                      binding.runbookVersionId ?? binding.runbook.publishedVersionId ?? ''
                    }
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    {availableRunbooks
                      .find(item => item.id === binding.runbookId)
                      ?.versions.filter(
                        version => version.state === 'PUBLISHED' || version.state === 'RETIRED'
                      )
                      .map(version => (
                        <option key={version.id} value={version.id}>
                          v{version.version} · {version.state}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Status">
                  <select
                    name="enabled"
                    defaultValue={String(binding.enabled)}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="true">Enabled</option>
                    <option value="false">Disabled</option>
                  </select>
                </Field>
                <Field label="Execution target">
                  <TargetSelect
                    agents={availableAgents}
                    pools={availableAgentPools}
                    defaultValue={
                      binding.defaultAgentId
                        ? `agent:${binding.defaultAgentId}`
                        : binding.defaultAgentPoolId
                          ? `pool:${binding.defaultAgentPoolId}`
                          : ''
                    }
                  />
                </Field>
                <div className="space-y-2 lg:col-span-4">
                  <Label>Input values (JSON)</Label>
                  <Textarea
                    name="inputValues"
                    className="min-h-28 font-mono text-xs"
                    defaultValue={JSON.stringify(binding.inputValues, null, 2)}
                  />
                </div>
                <div className="flex gap-2 lg:col-span-4">
                  <Button type="submit" variant="outline">
                    <Settings2 /> Save binding
                  </Button>
                  <Button
                    type="submit"
                    variant="destructive"
                    formAction={detachRunbookAction.bind(null, serviceId, binding.id)}
                  >
                    <Trash2 /> Detach
                  </Button>
                </div>
              </form>
            ) : (
              <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(binding.inputValues, null, 2)}
              </pre>
            )}
            {canManage && (
              <form
                action={configureRunbookTriggerAction.bind(null, serviceId, binding.id)}
                className="mt-4 grid gap-3 border-t pt-4 lg:grid-cols-3"
              >
                <Field label="Trigger event">
                  <select
                    name="event"
                    defaultValue="INCIDENT_CREATED"
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="INCIDENT_CREATED">Incident created</option>
                  </select>
                </Field>
                <Field label="Condition logic">
                  <select
                    name="conditionLogic"
                    defaultValue={binding.triggers[0]?.conditionLogic ?? 'AND'}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="AND">Match all</option>
                    <option value="OR">Match any</option>
                  </select>
                </Field>
                <div className="flex items-end">
                  <Button type="submit" variant="outline">
                    Save trigger
                  </Button>
                </div>
                <div className="space-y-2 lg:col-span-3">
                  <Label>Conditions (JSON)</Label>
                  <Textarea
                    name="conditions"
                    className="min-h-28 font-mono text-xs"
                    defaultValue={JSON.stringify(
                      (binding.triggers[0]?.conditions ?? []).map(
                        ({ field, operator, value, sequence }) => ({
                          field,
                          operator,
                          value,
                          sequence,
                        })
                      ),
                      null,
                      2
                    )}
                    placeholder='[{"field":"incident.urgency","operator":"EQUALS","value":"HIGH","sequence":0}]'
                  />
                  <p className="text-xs text-muted-foreground">
                    An empty list matches every event. Automatic mode still stops at steps requiring
                    approval.
                  </p>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      ))}
      {bindings.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No runbooks are attached to this service.
          </CardContent>
        </Card>
      )}
      {canManage && unattached.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Link2 /> Attach a runbook
            </CardTitle>
            <CardDescription>Automatic mode requires an immutable pinned version.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              action={attachRunbookAction.bind(null, serviceId)}
              className="grid gap-3 lg:grid-cols-3"
            >
              <Field label="Runbook">
                <select
                  name="runbookSelection"
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                >
                  {unattached.map(runbook => (
                    <option key={runbook.id} value={`${runbook.id}:${runbook.publishedVersionId}`}>
                      {runbook.name} · v{runbook.publishedVersion?.version}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Mode">
                <select
                  name="mode"
                  defaultValue="MANUAL"
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                >
                  <option value="MANUAL">Manual</option>
                  <option value="SUGGESTED">Suggested</option>
                  <option value="AUTOMATIC">Automatic</option>
                </select>
              </Field>
              <Field label="Version strategy">
                <select
                  name="versionStrategy"
                  defaultValue="LATEST_PUBLISHED"
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                >
                  <option value="LATEST_PUBLISHED">Latest published</option>
                  <option value="PINNED">Pinned</option>
                </select>
              </Field>
              <Field label="Execution target">
                <TargetSelect agents={availableAgents} pools={availableAgentPools} />
              </Field>
              <div className="space-y-2 lg:col-span-3">
                <Label>Input values (JSON)</Label>
                <Textarea name="inputValues" className="font-mono text-xs" defaultValue="{}" />
              </div>
              <div className="lg:col-span-3">
                <Button type="submit">Attach runbook</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function TargetSelect({
  agents,
  pools,
  defaultValue = '',
}: {
  agents: Array<{ id: string; name: string; hostname: string | null }>;
  pools: Array<{ id: string; name: string; mode: string }>;
  defaultValue?: string;
}) {
  return (
    <select
      name="executionTarget"
      defaultValue={defaultValue}
      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
    >
      <option value="">No Agent target</option>
      {pools.length > 0 && (
        <optgroup label="Agent pools">
          {pools.map(pool => (
            <option key={pool.id} value={`pool:${pool.id}`}>
              {pool.name} · {pool.mode.replaceAll('_', ' ')}
            </option>
          ))}
        </optgroup>
      )}
      {agents.length > 0 && (
        <optgroup label="Specific Agents">
          {agents.map(agent => (
            <option key={agent.id} value={`agent:${agent.id}`}>
              {agent.name}
              {agent.hostname ? ` · ${agent.hostname}` : ''}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
