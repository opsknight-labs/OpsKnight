import Link from 'next/link';
import { ArrowRight, Lock, ShieldQuestion, Users } from 'lucide-react';

import type { AccessExplanation } from '@/lib/access/server';
import { roleLabel } from '@/lib/authorization';
import RequestAccessForm from '@/components/access/RequestAccessForm';
import BreakGlassButton from '@/components/access/BreakGlassButton';
import { BackButton, CopyDetailsButton } from '@/components/access/AccessDeniedActions';
import { ContactChip, Fact } from '@/components/access/AccessUi';

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
    ? explanation.alreadyInOwningTeam
      ? `This ${noun ?? 'item'} is private. Even members of the ${owningTeam?.name ?? 'owning'} team need to be assigned to it, be paged for it, or be added as a watcher. Responders and Admins can open it.`
      : owningTeam
        ? `This ${noun ?? 'item'} belongs to the ${owningTeam.name} team. Members of that team, people assigned to it or paged for it, and Responders and Admins can open it.`
        : `It belongs to a team you are not part of. Members of that team, people assigned to it or paged for it, and Responders and Admins can open it.`
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
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
      >
        <div className="space-y-6 p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/40">
              <Lock className="h-5 w-5 text-amber-700 dark:text-amber-300" aria-hidden />
            </div>
            <div className="min-w-0 space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Access denied · 403
              </p>
              <h1
                id="access-denied-title"
                className="text-xl font-bold tracking-tight text-foreground sm:text-2xl"
              >
                {title}
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground">{reason}</p>
            </div>
          </div>

          {snapshot && (
            <dl className="grid gap-4 rounded-lg border border-border bg-muted/30 p-4 sm:grid-cols-2">
              <Fact label="Your role">
                <span className="font-medium">
                  {roleLabel(snapshot.role)}
                  {snapshot.customRole ? ` + ${snapshot.customRole.name}` : ''}
                </span>
                {snapshot.roleSource !== 'MANUAL' && (
                  <span className="block text-xs text-muted-foreground">
                    Managed by your identity provider
                  </span>
                )}
              </Fact>
              {requirement && !resourceDenied && (
                <Fact label="Needed">
                  <span className="font-medium">{requirement.rolesText}</span>
                </Fact>
              )}
              <Fact label="Your teams" className="sm:col-span-2">
                {snapshot.teams.length > 0 ? (
                  snapshot.teams.map(team => team.name).join(', ')
                ) : (
                  <span className="text-muted-foreground">You are not in any team yet</span>
                )}
              </Fact>
            </dl>
          )}

          <div className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
              {grantors.kind === 'team_owner'
                ? `Who can add you to ${grantors.teamName ?? 'the team'}`
                : 'Who can give you access'}
            </h2>
            {grantors.people.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {grantors.people.map(person => (
                  <li key={person.id} className="p-0">
                    <ContactChip
                      name={person.name}
                      email={person.email}
                      subject={`OpsKnight access: ${explanation.label}`}
                    />
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
            <div className="space-y-4 border-t border-border pt-6">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <ShieldQuestion className="h-4 w-4 text-muted-foreground" aria-hidden />
                Request access
              </h2>
              <RequestAccessForm
                originPath={explanation.path}
                requiredCapability={requirement?.anyOf[0]}
                currentRole={snapshot.role}
                suggestedRole={explanation.suggestedRole}
                team={resourceDenied && !explanation.alreadyInOwningTeam ? owningTeam : null}
                canRequestOrgRole={explanation.canRequestOrgRole}
                compact={variant === 'mobile'}
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/30 px-6 py-4 sm:px-8">
          <BackButton />
          <Link
            href="/settings/access"
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-primary hover:bg-primary/5"
          >
            See what you can access
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
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
