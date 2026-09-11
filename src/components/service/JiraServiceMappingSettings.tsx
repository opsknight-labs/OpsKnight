'use client';

import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { saveJiraServiceMapping } from '@/app/(app)/services/actions';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import { Badge } from '@/components/ui/shadcn/badge';
import { Loader2, Tickets, XCircle } from 'lucide-react';
import { notify } from '@/lib/toast';

type JiraMapping = {
  projectKey: string;
  incidentIssueType: string;
  actionItemIssueType: string;
  defaultLabels: string[];
  defaultComponent: string | null;
  autoCreateIncidentIssue: boolean;
  autoCreateIncidentUrgencies: string[];
  syncEnabled: boolean;
} | null;

const URGENCY_OPTIONS = [
  { value: 'HIGH', label: 'High' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'LOW', label: 'Low' },
];

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending}>
      {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      Save Jira Mapping
    </Button>
  );
}

export default function JiraServiceMappingSettings({
  serviceId,
  mapping,
  jiraEnabled,
  canManage,
}: {
  serviceId: string;
  mapping: JiraMapping;
  jiraEnabled: boolean;
  canManage: boolean;
}) {
  const [state, formAction] = useActionState(saveJiraServiceMapping, {
    error: null,
    success: false,
  });

  useEffect(() => {
    if (state?.success) {
      notify.success('Jira mapping saved', { id: `service:${serviceId}:jira-mapping:save` });
    } else if (state?.error) {
      notify.error(state.error);
    }
  }, [state, serviceId]);

  // Product contract: unavailable integrations do not leak operational/configuration
  // surfaces into normal service settings. The workspace integration page is the
  // single place to connect or re-enable Jira.
  if (!jiraEnabled) return null;

  const selectedAutoCreateUrgencies =
    mapping && mapping.autoCreateIncidentUrgencies.length > 0
      ? mapping.autoCreateIncidentUrgencies
      : mapping
        ? URGENCY_OPTIONS.map(option => option.value)
        : ['HIGH'];

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Tickets className="h-4 w-4 text-slate-500" />
              Jira Workflow Mapping
            </CardTitle>
            <CardDescription>
              Route this service&apos;s incidents and follow-up work to the right Jira project.
            </CardDescription>
          </div>
          <Badge variant="default">Workspace connected</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="serviceId" value={serviceId} />
          {state?.error && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="jira-project-key">Project Key</Label>
              <Input
                id="jira-project-key"
                name="projectKey"
                defaultValue={mapping?.projectKey ?? ''}
                placeholder="OPS"
                disabled={!canManage}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="jira-component">Default Component</Label>
              <Input
                id="jira-component"
                name="defaultComponent"
                defaultValue={mapping?.defaultComponent ?? ''}
                placeholder="API Platform"
                disabled={!canManage}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="incident-issue-type">Incident Issue Type</Label>
              <Input
                id="incident-issue-type"
                name="incidentIssueType"
                defaultValue={mapping?.incidentIssueType ?? 'Bug'}
                disabled={!canManage}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="action-item-issue-type">Action Item Issue Type</Label>
              <Input
                id="action-item-issue-type"
                name="actionItemIssueType"
                defaultValue={mapping?.actionItemIssueType ?? 'Task'}
                disabled={!canManage}
                required
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="jira-labels">Default Labels</Label>
              <Input
                id="jira-labels"
                name="defaultLabels"
                defaultValue={mapping?.defaultLabels.join(', ') ?? 'opsknight'}
                placeholder="opsknight, incident-response"
                disabled={!canManage}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex items-center gap-3 rounded-md border p-3 text-sm">
              <input
                type="checkbox"
                name="autoCreateIncidentIssue"
                defaultChecked={mapping?.autoCreateIncidentIssue ?? false}
                disabled={!canManage}
                className="h-4 w-4"
              />
              Auto-create Jira issues for new incidents
            </label>
            <label className="flex items-center gap-3 rounded-md border p-3 text-sm">
              <input
                type="checkbox"
                name="syncEnabled"
                defaultChecked={mapping?.syncEnabled ?? true}
                disabled={!canManage}
                className="h-4 w-4"
              />
              Sync Jira status metadata
            </label>
          </div>

          <div className="rounded-md border p-3">
            <Label className="text-sm font-medium">Auto-create for incident urgency</Label>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {URGENCY_OPTIONS.map(option => (
                <label key={option.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="autoCreateIncidentUrgencies"
                    value={option.value}
                    defaultChecked={selectedAutoCreateUrgencies.includes(option.value)}
                    disabled={!canManage}
                    className="h-4 w-4"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end border-t pt-4">
            <SubmitButton disabled={!canManage} />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
