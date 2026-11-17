import 'server-only';
/* eslint-disable security/detect-object-injection -- Indexes into the policy's own step array. */
import { Prisma } from '@prisma/client';
import {
  ackMinutesQuantile,
  loadPolicyStepOutcomes,
  type StepOutcomeSummary,
} from '@/lib/escalation/step-outcomes';
import type { OpsInsightItem } from '../contract';
import type { OpsInsightProducer } from '../producer';

/**
 * Escalation policy insights (plan J2), from the daily step-outcome rollup and the policy's own steps:
 * a step never acknowledged, step 1 timing out at night, a step always skipped, a shorter timeout the
 * acknowledgement times support, one person on every step, and a policy no service uses.
 *
 * Reads: the policy and its steps, a service count, one grouped read each for team and schedule sizes,
 * and one bounded rollup read. Evidence holds counts only: names are resolved by the page that shows it.
 */
export interface EscalationPolicyInput {
  policyId: string;
  /** Whole days since the policy was created, capped at 8 (only "at least a week" matters). */
  ageDays: number;
  services: number;
  steps: Array<{ id: string; delayMinutes: number }>;
  /** Every step reaches the same single person. */
  soleResponder: boolean;
  /**
   * Per step: it can reach only one person, so its acknowledgement numbers are that person's own record
   * (USER-scope data) and are not published on the policy.
   */
  personalSteps: boolean[];
  outcomes: StepOutcomeSummary[];
}

const MIN_PAGES = 5;
const MIN_ACKS_FOR_TIMEOUT = 10;
const TIMEOUT_BOUNDS = { min: 2, max: 60 } as const;

export const SKIP_REASON_LABELS: Record<string, string> = {
  CONDITIONS_NOT_MATCHED: 'its conditions never match',
  NO_TARGET: 'it has no target',
  TARGET_MISSING: 'its target no longer exists',
  TARGET_INACTIVE: 'its target user is not active',
  TARGET_INVALID: 'its target cannot be used',
  NO_ONE_ON_CALL: 'nobody is on call in its schedule',
  NO_ELIGIBLE_MEMBERS: 'its team has nobody to page',
  NO_ELIGIBLE_RESPONDERS: 'nobody it targets can be paged',
  NO_CONTACT_METHOD: 'the people it targets have no contact method',
};

export type PolicyStepTarget = {
  id: string;
  delayMinutes: number;
  targetType: 'USER' | 'TEAM' | 'SCHEDULE';
  targetUserId: string | null;
  targetTeamId: string | null;
  targetScheduleId: string | null;
  notifyOnlyTeamLead: boolean;
};

type Group = { id: string; people: number; only: string | null; lead: string | null };

type Step = PolicyStepTarget;

export const POLICY_STEP_TARGET_SELECT = {
  id: true,
  delayMinutes: true,
  targetType: true,
  targetUserId: true,
  targetTeamId: true,
  targetScheduleId: true,
  notifyOnlyTeamLead: true,
} as const;

/** The one person a step can reach, or null when it can reach none or several. */
function onlyPerson(step: Step, teams: Map<string, Group>, schedules: Map<string, Group>) {
  if (step.targetType === 'USER') return step.targetUserId;
  if (step.targetType === 'TEAM') {
    const team = step.targetTeamId ? teams.get(step.targetTeamId) : undefined;
    if (!team) return null;
    if (step.notifyOnlyTeamLead && team.lead) return team.lead;
    return team.people === 1 ? team.only : null;
  }
  const schedule = step.targetScheduleId ? schedules.get(step.targetScheduleId) : undefined;
  return schedule?.people === 1 ? schedule.only : null;
}

/**
 * Per step, the one person it can reach (null when none or several): one grouped read each for the
 * targeted teams and schedules.
 */
export async function policyStepPeople(
  tx: Prisma.TransactionClient,
  steps: readonly Step[]
): Promise<Array<string | null>> {
  const teamIds = [...new Set(steps.flatMap(step => step.targetTeamId ?? []))];
  const scheduleIds = [...new Set(steps.flatMap(step => step.targetScheduleId ?? []))];
  const teamRows = teamIds.length
    ? await tx.$queryRaw<Group[]>(Prisma.sql`
        SELECT t."id", t."teamLeadId" AS "lead", count(m."userId")::int AS "people",
          min(m."userId") AS "only"
        FROM "Team" t LEFT JOIN "TeamMember" m ON m."teamId" = t."id"
        WHERE t."id" IN (${Prisma.join(teamIds)})
        GROUP BY t."id", t."teamLeadId"`)
    : [];
  const scheduleRows = scheduleIds.length
    ? await tx.$queryRaw<Group[]>(Prisma.sql`
        SELECT l."scheduleId" AS "id", NULL AS "lead", count(DISTINCT u."userId")::int AS "people",
          min(u."userId") AS "only"
        FROM "OnCallLayer" l JOIN "OnCallLayerUser" u ON u."layerId" = l."id"
        WHERE l."scheduleId" IN (${Prisma.join(scheduleIds)})
        GROUP BY l."scheduleId"`)
    : [];
  const teams = new Map(teamRows.map(row => [row.id, row]));
  const schedules = new Map(scheduleRows.map(row => [row.id, row]));
  return steps.map(step => onlyPerson(step, teams, schedules));
}

export const escalationPolicyProducer: OpsInsightProducer<EscalationPolicyInput> = {
  kind: 'escalation.policy',
  area: 'escalation',
  scopeType: 'POLICY',

  version: 2,

  async loadInput(scope, { tx, now }) {
    const policy = await tx.escalationPolicy.findUnique({
      where: { id: scope.id },
      select: {
        archivedAt: true,
        createdAt: true,
        steps: {
          orderBy: { stepOrder: 'asc' },
          select: POLICY_STEP_TARGET_SELECT,
        },
      },
    });
    if (!policy || policy.archivedAt) return null;
    const steps = policy.steps as Step[];
    // Sequential: one interactive transaction runs one statement at a time anyway.
    const services = await tx.service.count({ where: { escalationPolicyId: scope.id } });
    const people = await policyStepPeople(tx, steps);
    const outcomes = await loadPolicyStepOutcomes(scope.id, now, tx);

    return {
      policyId: scope.id,
      ageDays: Math.min(8, Math.floor((now.getTime() - policy.createdAt.getTime()) / 86_400_000)),
      services,
      steps: steps.map(step => ({ id: step.id, delayMinutes: step.delayMinutes })),
      soleResponder:
        people.length > 0 && people.every(person => person !== null && person === people[0]),
      personalSteps: people.map(person => person !== null),
      outcomes: outcomes.steps,
    };
  },

  derive(input) {
    const items: OpsInsightItem[] = [];
    const stepsHref = `/policies/${input.policyId}?tab=steps`;
    const window = 'last 30 days';
    const label = (step: number) => `Step ${step + 1}`;
    const pct = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`;

    for (const outcome of input.outcomes) {
      // Steps that no longer exist (the policy was shortened) are not judged.
      if (outcome.step >= input.steps.length) continue;
      const name = label(outcome.step);
      // A one-person step's acknowledgement numbers are that person's record: not published here.
      const personal = input.personalSteps[outcome.step] ?? true;

      if (!personal && outcome.paged >= MIN_PAGES && outcome.acked === 0) {
        items.push({
          key: `never-acked:${outcome.step}`,
          severity: 'WARNING',
          title: `${name} was never acknowledged`,
          summary: `${outcome.paged} pages reached ${name.toLowerCase()} and none was acknowledged there. Check that the people it targets can receive and answer pages.`,
          evidence: {
            window,
            facts: [
              { label: 'Pages', value: String(outcome.paged) },
              { label: 'Acknowledged', value: '0' },
              { label: 'Passed to the next step', value: String(outcome.timedOut) },
            ],
          },
          draftHref: stepsHref,
        });
      }

      const attempts = outcome.paged + outcome.skipped + outcome.failed;
      if (attempts >= MIN_PAGES && outcome.paged === 0) {
        const [reason, count] = Object.entries(outcome.reasons).sort((a, b) => b[1] - a[1])[0] ?? [
          'NO_ELIGIBLE_RESPONDERS',
          attempts,
        ];
        items.push({
          key: `always-skipped:${outcome.step}`,
          severity: 'WARNING',
          title: `${name} is always skipped`,
          summary: `${name} paged nobody in ${attempts} escalations because ${SKIP_REASON_LABELS[reason] ?? 'it could not be used'}. Incidents go straight to the next step.`,
          evidence: {
            window,
            facts: [
              { label: 'Escalations reaching the step', value: String(attempts) },
              { label: 'Skipped', value: String(outcome.skipped) },
              { label: 'No contact method', value: String(outcome.failed) },
              {
                label: 'Most common reason',
                value: `${SKIP_REASON_LABELS[reason] ?? reason} (${count})`,
              },
            ],
          },
          draftHref: stepsHref,
        });
      }

      if (!personal && outcome.step === 0 && outcome.nightPaged >= MIN_PAGES) {
        const nightRate = outcome.nightTimedOut / outcome.nightPaged;
        const dayRate = outcome.dayPaged > 0 ? outcome.dayTimedOut / outcome.dayPaged : 0;
        if (nightRate >= 0.5 && nightRate - dayRate >= 0.2) {
          items.push({
            key: 'night-timeouts',
            severity: 'WARNING',
            title: 'Step 1 times out most nights',
            summary: `${pct(outcome.nightTimedOut, outcome.nightPaged)} of night pages (22:00 to 07:00 for the person paged) passed to step 2 unanswered, against ${pct(outcome.dayTimedOut, Math.max(outcome.dayPaged, 1))} by day. Consider a night layer or a follow-the-sun schedule for step 1.`,
            evidence: {
              window,
              facts: [
                { label: 'Night pages', value: String(outcome.nightPaged) },
                { label: 'Night pages timed out', value: String(outcome.nightTimedOut) },
                { label: 'Day pages', value: String(outcome.dayPaged) },
                { label: 'Day pages timed out', value: String(outcome.dayTimedOut) },
              ],
            },
            draftHref: stepsHref,
          });
        }
      }

      // The wait before the next step is that step's delay.
      const next = input.steps[outcome.step + 1];
      const p75 = ackMinutesQuantile(outcome, 0.75);
      if (
        !personal &&
        next &&
        p75 !== null &&
        outcome.acked >= MIN_ACKS_FOR_TIMEOUT &&
        outcome.timedOut > 0
      ) {
        const suggested = Math.min(TIMEOUT_BOUNDS.max, Math.max(TIMEOUT_BOUNDS.min, p75));
        const saved = next.delayMinutes - suggested;
        if (saved >= 3 && suggested <= next.delayMinutes * 0.75) {
          const slower = Object.entries(outcome.ackWithin)
            .filter(([bucket]) => Number(bucket) > suggested)
            .reduce((sum, [, count]) => sum + count, 0);
          items.push({
            key: `timeout:${outcome.step + 1}`,
            severity: 'INFO',
            title: `Wait ${suggested} minutes before ${label(outcome.step + 1).toLowerCase()}, not ${next.delayMinutes}`,
            summary: `75% of acknowledgements at ${name.toLowerCase()} came within ${suggested} minutes. With that wait, ${outcome.timedOut} incidents would have reached ${label(outcome.step + 1).toLowerCase()} ${saved} minutes sooner; ${slower} slower acknowledgements would also have paged it.`,
            evidence: {
              window,
              facts: [
                { label: 'Acknowledged at this step', value: String(outcome.acked) },
                { label: '75% acknowledged within', value: `${p75 > 120 ? 'over 120' : p75} min` },
                { label: 'Current wait', value: `${next.delayMinutes} min` },
                { label: 'Suggested wait', value: `${suggested} min` },
                {
                  label: 'Incidents reaching the next step sooner',
                  value: String(outcome.timedOut),
                },
                { label: 'Extra pages to the next step', value: String(slower) },
              ],
            },
            draftHref: `${stepsHref}&suggestStep=${encodeURIComponent(next.id)}&suggestDelay=${suggested}`,
          });
        }
      }
    }

    if (input.soleResponder) {
      items.push({
        key: 'single-person',
        severity: 'WARNING',
        title: 'One person is on every step',
        summary:
          'Every step of this policy reaches the same single person, so nobody covers for them when they are away or asleep. Add a team, a schedule or a second person.',
        evidence: { facts: [{ label: 'Steps', value: String(input.steps.length) }] },
        draftHref: stepsHref,
      });
    }

    if (input.services === 0 && input.ageDays >= 7) {
      items.push({
        key: 'unused',
        severity: 'INFO',
        title: 'No service uses this policy',
        summary:
          'No service escalates through this policy. Attach it to a service, or archive it so responders do not pick it by mistake.',
        evidence: { facts: [{ label: 'Services', value: '0' }] },
        draftHref: `/policies/${input.policyId}?tab=settings`,
      });
    }
    return items;
  },
};
