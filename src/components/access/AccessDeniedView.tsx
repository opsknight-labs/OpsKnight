import Link from 'next/link';
import { Lock, Mail, ShieldQuestion, Users } from 'lucide-react';

import type { AccessExplanation } from '@/lib/access/server';
import { roleLabel } from '@/lib/authorization';
import RequestAccessForm from '@/components/access/RequestAccessForm';
import BreakGlassButton from '@/components/access/BreakGlassButton';
import { BackButton, CopyDetailsButton } from '@/components/access/AccessDeniedActions';

const RESOURCE_NOUNS = new Map<string, string>([
  ['incident', 'incident'],
  ['postmortem', 'postmortem'],
  ['service', 'service'],
  ['team', 'team'],
  ['schedule', 'schedule'],
  ['policy', 'escalation policy'],
  ['runbook', 'runbook'],
  ['report', 'dashboard'],
  ['user', 'user profile'],
  ['status_page', 'status page'],
]);

/**
 * The 403 experience: what was blocked, why, what the person currently has, who can grant
 * access, and a way to ask for it. Never shows the contents of the blocked resource.
 */
export default function AccessDeniedView({
  explanation,
  variant = 'page',
}: {
  explanation: AccessExplanation;
  variant?: 'page' | 'mobile';
}) {
  const { snapshot, requirement, resourceDenied, owningTeam, grantors } = explanation;
  const noun = explanation.resourceType
    ? (RESOURCE_NOUNS.get(explanation.resourceType) ?? null)
    : null;
  const title = resourceDenied
    ? `You don’t have access to this ${noun ?? 'item'}`
    : `You don’t have access to ${explanation.label}`;

  const reason = resourceDenied
    ? owningTeam
      ? `This ${noun ?? 'item'} belongs to the ${owningTeam.name} team. Members of that team, people assigned to it, and Responders and Admins can open it.`
      : `It belongs to a team you are not part of. Members of that team, people assigned to it, and Responders and Admins can open it.`
    : requirement
      ? `${requirement.summary}. It lets people ${requirement.capabilityText.toLowerCase()}.`
      : 'Your account cannot open this page.';

  const isOperator = snapshot?.capabilities.includes('operations.manage') ?? false;
  const incidentIdForBreakGlass =
    resourceDenied && explanation.resourceType === 'incident' ? explanation.resourceId : null;
  const showBreakGlass = Boolean(
    snapshot?.settings.breakGlassEnabled && !isOperator && incidentIdForBreakGlass
  );

  const supportDetails = [
    `Page: ${explanation.path}`,
    `Your role: ${snapshot ? roleLabel(snapshot.role) : 'Not signed in'}`,
    requirement ? `Required: ${requirement.rolesText} (${requirement.anyOf.join(' or ')})` : null,
    owningTeam ? `Owning team: ${owningTeam.name}` : null,
    `Time: ${new Date().toISOString()}`,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <div
      className={
        variant === 'mobile' ? 'px-4 py-6' : 'flex w-full justify-center px-4 py-10 sm:py-16'
      }
    >
      <section
        aria-labelledby="access-denied-title"
        className="w-full max-w-2xl rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8"
      >
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
            <Lock className="h-5 w-5 text-amber-700 dark:text-amber-300" aria-hidden />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Access denied · 403
            </p>
            <h1 id="access-denied-title" className="text-xl font-semibold text-foreground">
              {title}
            </h1>
            <p className="text-sm text-muted-foreground">{reason}</p>
          </div>
        </div>

        {snapshot && (
          <dl className="mt-6 grid gap-4 rounded-lg bg-muted/40 p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Your role</dt>
              <dd className="font-medium text-foreground">
                {roleLabel(snapshot.role)}
                {snapshot.customRole ? ` + ${snapshot.customRole.name}` : ''}
                {snapshot.roleSource !== 'MANUAL' && (
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    (managed by your identity provider)
                  </span>
                )}
              </dd>
            </div>
            {requirement && !resourceDenied && (
              <div>
                <dt className="text-xs text-muted-foreground">Needed</dt>
                <dd className="font-medium text-foreground">{requirement.rolesText}</dd>
              </div>
            )}
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">Your teams</dt>
              <dd className="text-foreground">
                {snapshot.teams.length > 0
                  ? snapshot.teams.map(team => team.name).join(', ')
                  : 'You are not in any team yet'}
              </dd>
            </div>
          </dl>
        )}

        <div className="mt-6 space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Users className="h-4 w-4" aria-hidden />
            {grantors.kind === 'team_owner'
              ? `Who can add you to ${grantors.teamName ?? 'the team'}`
              : 'Who can give you access'}
          </h2>
          {grantors.people.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {grantors.people.map(person => (
                <li key={person.id}>
                  <a
                    href={`mailto:${person.email}?subject=${encodeURIComponent(`OpsKnight access: ${explanation.label}`)}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-foreground hover:bg-muted"
                  >
                    <Mail className="h-3 w-3" aria-hidden />
                    {person.name ?? person.email}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No administrator is available. Contact your OpsKnight owner.
            </p>
          )}
        </div>

        {snapshot && snapshot.settings.requestsEnabled && (
          <div className="mt-6 border-t border-border pt-6">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              <ShieldQuestion className="h-4 w-4" aria-hidden />
              Request access
            </h2>
            <RequestAccessForm
              originPath={explanation.path}
              requiredCapability={requirement?.anyOf[0]}
              currentRole={snapshot.role}
              suggestedRole={explanation.suggestedRole}
              team={resourceDenied ? owningTeam : null}
              canRequestOrgRole={explanation.canRequestOrgRole}
            />
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-6">
          <BackButton />
          <Link
            href="/settings/access"
            className="inline-flex h-8 items-center rounded-md px-3 text-sm text-primary hover:underline"
          >
            See what you can access
          </Link>
          {showBreakGlass && snapshot && (
            <BreakGlassButton
              maxMinutes={snapshot.settings.breakGlassMaxMinutes}
              incidentId={incidentIdForBreakGlass}
              returnPath={explanation.path}
            />
          )}
          <span className="flex-1" />
          <CopyDetailsButton details={supportDetails} />
        </div>
      </section>
    </div>
  );
}
