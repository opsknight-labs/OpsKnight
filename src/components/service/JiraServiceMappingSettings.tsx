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
    }
    // Errors render as a persistent inline Alert below (field-level recovery context).
    // Do not also toast the same text — one semantic notification per event.
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
    <Card className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs shadow-xs">
      <CardHeader className="pb-4 border-b border-border/60 bg-muted/20 dark:bg-muted/10">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-bold flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0 border border-primary/20 shadow-2xs">
                <Tickets className="h-4 w-4" />
              </div>
              <div>
                <span className="text-muted-foreground font-mono mr-1.5 text-xs">4.</span>
                <span>Jira Workflow Mapping</span>
              </div>
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              Route this service&apos;s incidents and follow-up work to the right Jira project.
            </CardDescription>
          </div>
          <Badge variant="default" className="text-[10px] font-semibold w-fit px-2.5 py-0.5">
            Workspace connected
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-5">
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="serviceId" value={serviceId} />
          {state?.error && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="jira-project-key" className="text-xs font-semibold">
                Project Key
              </Label>
              <Input
                id="jira-project-key"
                name="projectKey"
                defaultValue={mapping?.projectKey ?? ''}
                placeholder="OPS"
                disabled={!canManage}
                required
                className="text-xs h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="jira-component" className="text-xs font-semibold">
                Default Component
              </Label>
              <Input
                id="jira-component"
                name="defaultComponent"
                defaultValue={mapping?.defaultComponent ?? ''}
                placeholder="API Platform"
                disabled={!canManage}
                className="text-xs h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="incident-issue-type" className="text-xs font-semibold">
                Incident Issue Type
              </Label>
              <Input
                id="incident-issue-type"
                name="incidentIssueType"
                defaultValue={mapping?.incidentIssueType ?? 'Bug'}
                disabled={!canManage}
                required
                className="text-xs h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="action-item-issue-type" className="text-xs font-semibold">
                Action Item Issue Type
              </Label>
              <Input
                id="action-item-issue-type"
                name="actionItemIssueType"
                defaultValue={mapping?.actionItemIssueType ?? 'Task'}
                disabled={!canManage}
                required
                className="text-xs h-9"
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="jira-labels" className="text-xs font-semibold">
                Default Labels
              </Label>
              <Input
                id="jira-labels"
                name="defaultLabels"
                defaultValue={mapping?.defaultLabels.join(', ') ?? 'opsknight'}
                placeholder="opsknight, incident-response"
                disabled={!canManage}
                className="text-xs h-9"
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex items-center gap-3 rounded-xl border border-border/80 bg-muted/20 p-3 text-xs cursor-pointer hover:bg-muted/30 transition-colors">
              <input
                type="checkbox"
                name="autoCreateIncidentIssue"
                defaultChecked={mapping?.autoCreateIncidentIssue ?? false}
                disabled={!canManage}
                className="h-4 w-4 rounded border-input text-primary focus:ring-primary cursor-pointer disabled:cursor-not-allowed"
              />
              <span className="font-medium text-foreground">
                Auto-create Jira issues for new incidents
              </span>
            </label>
            <label className="flex items-center gap-3 rounded-xl border border-border/80 bg-muted/20 p-3 text-xs cursor-pointer hover:bg-muted/30 transition-colors">
              <input
                type="checkbox"
                name="syncEnabled"
                defaultChecked={mapping?.syncEnabled ?? true}
                disabled={!canManage}
                className="h-4 w-4 rounded border-input text-primary focus:ring-primary cursor-pointer disabled:cursor-not-allowed"
              />
              <span className="font-medium text-foreground">Sync Jira status metadata</span>
            </label>
          </div>

          <div className="rounded-xl border border-border/80 bg-muted/10 p-3.5 space-y-2">
            <Label className="text-xs font-semibold text-foreground">
              Auto-create for incident urgency
            </Label>
            <div className="grid gap-2 sm:grid-cols-3">
              {URGENCY_OPTIONS.map(option => (
                <label
                  key={option.value}
                  className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <input
                    type="checkbox"
                    name="autoCreateIncidentUrgencies"
                    value={option.value}
                    defaultChecked={selectedAutoCreateUrgencies.includes(option.value)}
                    disabled={!canManage}
                    className="h-4 w-4 rounded border-input text-primary focus:ring-primary cursor-pointer disabled:cursor-not-allowed"
                  />
                  <span>{option.label} Urgency</span>
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
