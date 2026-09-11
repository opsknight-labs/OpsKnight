import type { ActionItemExternalIssue } from '@/lib/action-items';
import type { JiraCapability } from '@/lib/jira-capabilities';
import ActionItemJiraBadge from '@/components/action-items/ActionItemJiraBadge';

interface ActionItemJiraContextProps {
  actionItemId: string;
  externalIssue?: ActionItemExternalIssue;
  canManage: boolean;
  compact?: boolean;
  jiraCapability: JiraCapability;
  labelClassName?: string;
}

/**
 * Canonical action-item Jira surface.
 *
 * Disabled/unconfigured Jira must not leave an empty "Action Item Jira" shell.
 * Historical links remain useful read-only context, so the section stays visible
 * when an action item already owns a Jira link.
 */
export default function ActionItemJiraContext({
  actionItemId,
  externalIssue,
  canManage,
  compact = false,
  jiraCapability,
  labelClassName = 'text-[10px]',
}: ActionItemJiraContextProps) {
  const hasHistoricalLink = Boolean(externalIssue);
  const canStartJiraTracking = jiraCapability.canCreate || jiraCapability.canLink;

  if (!hasHistoricalLink && !canStartJiraTracking) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        className={`font-semibold uppercase tracking-wide text-muted-foreground ${labelClassName}`}
      >
        Action Item Jira
      </span>
      <ActionItemJiraBadge
        actionItemId={actionItemId}
        externalIssue={externalIssue}
        canManage={canManage}
        compact={compact}
        jiraCapability={jiraCapability}
      />
    </div>
  );
}
