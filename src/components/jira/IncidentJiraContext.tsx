import JiraReferenceBadge from '@/components/jira/JiraReferenceBadge';
import type { JiraIssueReference } from '@/lib/jira-references';
import { cn } from '@/lib/utils';

export default function IncidentJiraContext({
  issues,
  compact = true,
  className,
  label = 'Incident Jira',
}: {
  issues: JiraIssueReference[];
  compact?: boolean;
  className?: string;
  label?: string;
}) {
  if (issues.length === 0) return null;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground',
        className
      )}
    >
      <span className="font-semibold text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {issues.map(issue => (
        <JiraReferenceBadge key={issue.linkId} issue={issue} compact={compact} />
      ))}
    </div>
  );
}
