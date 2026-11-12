import type { IncidentUrgency } from '@prisma/client';
import {
  addOperationalMetric,
  observeOperationalHistogram,
} from '@/lib/metrics/operational/registry';
import {
  PREPAGING_LIMITS,
  type NoiseControlDefinition,
  type NoiseControlModeValue,
  type OrchestrationAction,
  type PrePagingActionName,
  type PrePagingControlName,
  type PrePagingDecisionResult,
  type PrePagingFailOpenReason,
  type PrePagingInput,
  type PrePagingTransform,
} from './contract';
import { isLabelSubset, matchesAll, type CompiledMatcher } from './matchers';
import { isWindowActiveAt } from './recurrence';

/**
 * The pre-paging hook. It runs inside the ingestion transaction before an incident exists, so it is
 * bounded by one shared deadline (5 ms by default), reads only the in-process snapshot and a handful of
 * index-backed lookups, uses no model and no network, and fails open: any error, timeout or missing
 * snapshot yields `action: 'NONE'` and the event pages exactly as it does today. In SHADOW mode the
 * decision is computed and recorded but `apply` is false.
 *
 * Integration (one call in `processEvent`, before the new incident is written):
 *   const decision = await evaluatePrePagingControls(input, getPrePagingSnapshot(), prismaLookups(tx));
 *   if (decision.action !== 'NONE') await recordPrePagingDecision(tx, decision, { alertId });
 *   if (decision.apply) switch (decision.action) { … }   // SUPPRESS / DOWNGRADE / APPEND / GROUP_CHILD / HOLD / DROP / TRANSFORM
 */

export interface CompiledPolicy {
  scopeKey: string;
  serviceId: string | null;
  mode: NoiseControlModeValue;
  revision: number;
  /** The published version this compiled policy came from (null until the scope is backfilled). */
  versionId?: string | null;
  definition: NoiseControlDefinition;
  orchestration: Array<{
    id: string;
    name: string;
    conditions: CompiledMatcher[];
    actions: OrchestrationAction[];
  }>;
}

export interface CompiledWindow {
  id: string;
  name: string;
  scope: 'SERVICE' | 'TEAM' | 'LABEL' | 'ALL';
  serviceId: string | null;
  teamId: string | null;
  labelKey: string | null;
  labelValue: string | null;
  startsAt: Date;
  endsAt: Date;
  recurrence: string | null;
  effect: 'SUPPRESS' | 'DOWNGRADE';
  downgradeUrgency: IncidentUrgency | null;
  /** Ended early by an operator: matches nothing from this instant. */
  endedAt: Date | null;
}

export interface CompiledSuppressionRule {
  id: string;
  name: string;
  serviceId: string | null;
  matchers: CompiledMatcher[];
  effect: 'SUPPRESS' | 'DOWNGRADE';
  downgradeUrgency: IncidentUrgency | null;
  expiresAt: Date | null;
}

export interface PrePagingSnapshot {
  loadedAt: number;
  policies: ReadonlyMap<string, CompiledPolicy>;
  windows: readonly CompiledWindow[];
  rules: readonly CompiledSuppressionRule[];
  /** serviceId → teamId, for TEAM-scoped windows when the caller does not pass teamId. */
  serviceTeams: ReadonlyMap<string, string | null>;
  /** serviceId → approved dependency neighbourhood (itself included), for topology storms. */
  topology: ReadonlyMap<string, readonly string[]>;
}

/** The bounded, index-backed reads the hook may make. Each must be a single indexed query. */
export interface PrePagingLookups {
  findOpenIncidentByFingerprint(
    serviceId: string,
    fingerprintHash: string,
    since: Date
  ): Promise<{ id: string; labels: Record<string, string> | null } | null>;
  countRecentIncidents(serviceIds: readonly string[], since: Date): Promise<number>;
  findStormParent(serviceIds: readonly string[], since: Date): Promise<{ id: string } | null>;
  /** Alert statuses for the key, newest first, bounded. */
  recentAlertStatuses(
    serviceId: string,
    key: { dedupKey: string; fingerprintHash: string | null },
    since: Date,
    limit: number
  ): Promise<string[]>;
}

export interface EvaluateOptions {
  now?: Date;
  deadlineMs?: number;
}

const urgencyRank = (urgency: IncidentUrgency): number =>
  urgency === 'HIGH' ? 2 : urgency === 'MEDIUM' ? 1 : 0;

function labelOf(labels: Readonly<Record<string, string>>, key: string): string | null {
  if (!Object.hasOwn(labels, key)) return null;
  const value: unknown = Reflect.get(labels, key);
  return typeof value === 'string' ? value : null;
}

function result(
  base: Pick<PrePagingDecisionResult, 'mode' | 'policyRevision' | 'policyVersionId'>,
  fields: Partial<PrePagingDecisionResult> & {
    action: PrePagingActionName;
    control: PrePagingControlName | null;
    reason: string;
  },
  startedAt: number
): PrePagingDecisionResult {
  return {
    mode: base.mode,
    policyRevision: base.policyRevision,
    policyVersionId: base.policyVersionId ?? null,
    apply: base.mode === 'ON' && fields.action !== 'NONE' && !fields.failOpen,
    sourceId: null,
    sourceName: null,
    targetIncidentId: null,
    evidence: {},
    ...fields,
    elapsedMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
  };
}

function failOpen(
  reason: PrePagingFailOpenReason,
  mode: NoiseControlModeValue,
  startedAt: number,
  policyRevision: number | null = null,
  policyVersionId: string | null = null
): PrePagingDecisionResult {
  if (reason !== 'off') addOperationalMetric('opsknight_prepaging_fail_open_total', 1, { reason });
  return result(
    { mode, policyRevision, policyVersionId },
    { action: 'NONE', control: null, reason: `fail-open: ${reason}`, failOpen: { reason } },
    startedAt
  );
}

export function resolvePolicy(
  snapshot: PrePagingSnapshot,
  serviceId: string
): CompiledPolicy | null {
  return snapshot.policies.get(`service:${serviceId}`) ?? snapshot.policies.get('global') ?? null;
}

function windowApplies(
  window: CompiledWindow,
  input: PrePagingInput,
  teamId: string | null
): boolean {
  switch (window.scope) {
    case 'ALL':
      return true;
    case 'SERVICE':
      return window.serviceId === input.serviceId;
    case 'TEAM':
      return teamId !== null && window.teamId === teamId;
    case 'LABEL':
      return (
        window.labelKey !== null &&
        window.labelValue !== null &&
        labelOf(input.labels, window.labelKey)?.toLowerCase() === window.labelValue.toLowerCase()
      );
    default:
      return false;
  }
}

function lowerUrgency(current: IncidentUrgency, target: IncidentUrgency | null): IncidentUrgency {
  if (!target) return 'LOW';
  return urgencyRank(target) < urgencyRank(current) ? target : current;
}

/**
 * Synchronous controls: orchestration, maintenance windows and suppression rules. Pure, so it is unit
 * tested on its own and reused by the simulation. Returns the decision, or the transforms collected
 * so far when nothing decisive matched.
 */
export function decideStatic(
  input: PrePagingInput,
  policy: CompiledPolicy,
  snapshot: PrePagingSnapshot,
  now: Date
): {
  decision: Omit<PrePagingDecisionResult, 'elapsedMs' | 'mode' | 'policyRevision' | 'apply'> | null;
  transform: PrePagingTransform | null;
} {
  const transform: PrePagingTransform = {};
  let transformed = false;
  const ruleHits: string[] = [];
  for (const rule of policy.orchestration) {
    if (!matchesAll(rule.conditions, input)) continue;
    ruleHits.push(rule.id);
    for (const action of rule.actions) {
      switch (action.type) {
        case 'DROP':
          return {
            decision: {
              action: 'DROP',
              control: 'ORCHESTRATION',
              reason: `Dropped by orchestration rule "${rule.name}"`,
              sourceId: rule.id,
              sourceName: rule.name,
              targetIncidentId: null,
              evidence: { ruleId: rule.id, matchedRules: ruleHits },
            },
            transform: null,
          };
        case 'SUPPRESS':
          return {
            decision: {
              action: 'SUPPRESS',
              control: 'ORCHESTRATION',
              reason: `Suppressed by orchestration rule "${rule.name}"`,
              sourceId: rule.id,
              sourceName: rule.name,
              targetIncidentId: null,
              evidence: { ruleId: rule.id, matchedRules: ruleHits },
              transform: transformed ? transform : undefined,
            },
            transform: null,
          };
        case 'SET_SEVERITY':
          transform.severity = action.value;
          transformed = true;
          break;
        case 'SET_URGENCY':
          transform.urgency = action.value;
          transformed = true;
          break;
        case 'SET_LABEL':
          transform.labels = {
            ...(transform.labels ?? {}),
            [action.key.toLowerCase()]: action.value,
          };
          transformed = true;
          break;
        case 'REROUTE_SERVICE':
          transform.serviceId = action.serviceId;
          transformed = true;
          break;
        case 'ATTACH_RUNBOOK':
          transform.runbookIds = [...new Set([...(transform.runbookIds ?? []), action.runbookId])];
          transformed = true;
          break;
        case 'ADD_NOTE':
          transform.notes = [...(transform.notes ?? []), action.text];
          transformed = true;
          break;
        default:
          break;
      }
    }
  }
  const effectiveUrgency = transform.urgency ?? input.urgency;
  const teamId = input.teamId ?? snapshot.serviceTeams.get(input.serviceId) ?? null;

  for (const window of snapshot.windows) {
    if (window.endedAt && window.endedAt.getTime() <= now.getTime()) continue;
    if (!windowApplies(window, input, teamId)) continue;
    if (!isWindowActiveAt(window, now)) continue;
    const evidence = { windowId: window.id, scope: window.scope, matchedRules: ruleHits };
    if (window.effect === 'SUPPRESS')
      return {
        decision: {
          action: 'SUPPRESS',
          control: 'MAINTENANCE',
          reason: `In maintenance window "${window.name}"`,
          sourceId: window.id,
          sourceName: window.name,
          targetIncidentId: null,
          evidence,
          transform: transformed ? transform : undefined,
        },
        transform: null,
      };
    const urgency = lowerUrgency(effectiveUrgency, window.downgradeUrgency);
    if (urgency !== effectiveUrgency)
      return {
        decision: {
          action: 'DOWNGRADE',
          control: 'MAINTENANCE',
          reason: `Downgraded to ${urgency} by maintenance window "${window.name}"`,
          sourceId: window.id,
          sourceName: window.name,
          targetIncidentId: null,
          urgency,
          evidence,
          transform: transformed ? transform : undefined,
        },
        transform: null,
      };
  }

  for (const rule of snapshot.rules) {
    if (rule.serviceId !== null && rule.serviceId !== input.serviceId) continue;
    if (rule.expiresAt && rule.expiresAt.getTime() <= now.getTime()) continue;
    if (!matchesAll(rule.matchers, input)) continue;
    const evidence = { ruleId: rule.id, matchedRules: ruleHits };
    if (rule.effect === 'SUPPRESS')
      return {
        decision: {
          action: 'SUPPRESS',
          control: 'SUPPRESSION',
          reason: `Suppressed by rule "${rule.name}"`,
          sourceId: rule.id,
          sourceName: rule.name,
          targetIncidentId: null,
          evidence,
          transform: transformed ? transform : undefined,
        },
        transform: null,
      };
    const urgency = lowerUrgency(effectiveUrgency, rule.downgradeUrgency);
    if (urgency !== effectiveUrgency)
      return {
        decision: {
          action: 'DOWNGRADE',
          control: 'SUPPRESSION',
          reason: `Downgraded to ${urgency} by rule "${rule.name}"`,
          sourceId: rule.id,
          sourceName: rule.name,
          targetIncidentId: null,
          urgency,
          evidence,
          transform: transformed ? transform : undefined,
        },
        transform: null,
      };
  }
  return {
    decision: null,
    transform: transformed ? { ...transform, notes: transform.notes } : null,
  };
}

/** Counts TRIGGERED↔RESOLVED transitions in a newest-first status list. */
export function countTransitions(statuses: readonly string[]): number {
  let transitions = 0;
  let previous: string | undefined;
  for (const status of statuses) {
    if (previous !== undefined && status !== previous) transitions += 1;
    previous = status;
  }
  return transitions;
}

async function decideWithLookups(
  input: PrePagingInput,
  policy: CompiledPolicy,
  snapshot: PrePagingSnapshot,
  lookups: PrePagingLookups,
  now: Date,
  transform: PrePagingTransform | null
): Promise<Omit<PrePagingDecisionResult, 'elapsedMs' | 'mode' | 'policyRevision' | 'apply'>> {
  const definition = policy.definition;
  const urgency = transform?.urgency ?? input.urgency;
  const highBypass = urgency === 'HIGH' && !definition.allowHighUrgency;
  const transformOnly = transform
    ? {
        action: 'TRANSFORM' as const,
        control: 'ORCHESTRATION' as const,
        reason: 'Transformed by orchestration rules',
        sourceId: null,
        sourceName: null,
        targetIncidentId: null,
        transform,
        evidence: { transform },
      }
    : {
        action: 'NONE' as const,
        control: null,
        reason: 'No control matched',
        sourceId: null,
        sourceName: null,
        targetIncidentId: null,
        evidence: {},
      };
  if (highBypass)
    return { ...transformOnly, evidence: { ...transformOnly.evidence, highUrgencyBypass: true } };

  if (definition.contentDedup.enabled && input.fingerprintHash) {
    const since = new Date(now.getTime() - definition.contentDedup.windowSeconds * 1000);
    const open = await lookups.findOpenIncidentByFingerprint(
      input.serviceId,
      input.fingerprintHash,
      since
    );
    if (
      open &&
      (!definition.contentDedup.requireLabelSubset || isLabelSubset(input.labels, open.labels))
    ) {
      return {
        action: 'APPEND',
        control: 'CONTENT_DEDUP',
        reason: 'Same content as an open incident; appended as an alert',
        sourceId: null,
        sourceName: null,
        targetIncidentId: open.id,
        transform: transform ?? undefined,
        evidence: {
          fingerprintHash: input.fingerprintHash,
          windowSeconds: definition.contentDedup.windowSeconds,
        },
      };
    }
  }

  if (definition.flapping.enabled) {
    const since = new Date(now.getTime() - definition.flapping.windowSeconds * 1000);
    const statuses = await lookups.recentAlertStatuses(
      input.serviceId,
      {
        dedupKey: input.dedupKey,
        fingerprintHash: definition.flapping.keyOnFingerprint ? input.fingerprintHash : null,
      },
      since,
      20
    );
    const transitions = countTransitions(statuses);
    if (
      statuses.length >= definition.flapping.threshold &&
      transitions >= definition.flapping.threshold
    ) {
      return {
        action: 'SUPPRESS',
        control: 'FLAPPING',
        reason: `Flapping: ${transitions} state changes in ${definition.flapping.windowSeconds}s`,
        sourceId: null,
        sourceName: null,
        targetIncidentId: null,
        transform: transform ?? undefined,
        evidence: {
          transitions,
          threshold: definition.flapping.threshold,
          windowSeconds: definition.flapping.windowSeconds,
        },
      };
    }
  }

  if (definition.storm.enabled) {
    const scope = definition.storm.topology
      ? (snapshot.topology.get(input.serviceId) ?? [input.serviceId])
      : [input.serviceId];
    const since = new Date(now.getTime() - definition.storm.windowSeconds * 1000);
    const recent = await lookups.countRecentIncidents(scope, since);
    if (recent >= definition.storm.threshold) {
      const parent = await lookups.findStormParent(scope, since);
      if (parent) {
        return {
          action: 'GROUP_CHILD',
          control: 'STORM',
          reason: `Storm: ${recent} incidents in ${definition.storm.windowSeconds}s; grouped under the parent`,
          sourceId: null,
          sourceName: null,
          targetIncidentId: parent.id,
          transform: transform ?? undefined,
          evidence: {
            recentIncidents: recent,
            threshold: definition.storm.threshold,
            scope: scope.length,
            topology: definition.storm.topology,
          },
        };
      }
    } else if (
      definition.storm.holdSeconds > 0 &&
      urgency !== 'HIGH' &&
      recent >=
        Math.max(PREPAGING_LIMITS.storm.minThreshold, Math.ceil(definition.storm.threshold / 2))
    ) {
      // Half-way to a storm: hold briefly so a burst that becomes a storm is absorbed instead of paging
      // several times. The hold is bounded and never applied to HIGH urgency.
      return {
        action: 'HOLD',
        control: 'STORM',
        reason: `Possible storm: ${recent} incidents in ${definition.storm.windowSeconds}s; held ${definition.storm.holdSeconds}s`,
        sourceId: null,
        sourceName: null,
        targetIncidentId: null,
        holdUntil: new Date(now.getTime() + definition.storm.holdSeconds * 1000),
        transform: transform ?? undefined,
        evidence: {
          recentIncidents: recent,
          threshold: definition.storm.threshold,
          holdSeconds: definition.storm.holdSeconds,
        },
      };
    }
  }
  return transformOnly;
}

export async function evaluatePrePagingControls(
  input: PrePagingInput,
  snapshot: PrePagingSnapshot | null,
  lookups: PrePagingLookups,
  options: EvaluateOptions = {}
): Promise<PrePagingDecisionResult> {
  const startedAt = performance.now();
  const now = options.now ?? input.receivedAt;
  if (!snapshot) return failOpen('cache_cold', 'OFF', startedAt);
  const policy = resolvePolicy(snapshot, input.serviceId);
  if (!policy || policy.mode === 'OFF')
    return failOpen('off', 'OFF', startedAt, policy?.revision ?? null, policy?.versionId ?? null);
  const policyVersionId = policy.versionId ?? null;
  const base = { mode: policy.mode, policyRevision: policy.revision, policyVersionId };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const stage = decideStatic(input, policy, snapshot, now);
    let decision = stage.decision;
    if (!decision) {
      const deadlineMs = options.deadlineMs ?? PREPAGING_LIMITS.deadlineMs;
      const needsLookups =
        policy.definition.contentDedup.enabled ||
        policy.definition.flapping.enabled ||
        policy.definition.storm.enabled;
      if (needsLookups) {
        const deadline = new Promise<'deadline'>(resolve => {
          timer = setTimeout(() => resolve('deadline'), deadlineMs);
        });
        const outcome = await Promise.race([
          decideWithLookups(input, policy, snapshot, lookups, now, stage.transform),
          deadline,
        ]);
        if (outcome === 'deadline')
          return failOpen('deadline', policy.mode, startedAt, policy.revision, policyVersionId);
        decision = outcome;
      } else {
        decision = stage.transform
          ? {
              action: 'TRANSFORM',
              control: 'ORCHESTRATION',
              reason: 'Transformed by orchestration rules',
              sourceId: null,
              sourceName: null,
              targetIncidentId: null,
              transform: stage.transform,
              evidence: { transform: stage.transform },
            }
          : {
              action: 'NONE',
              control: null,
              reason: 'No control matched',
              sourceId: null,
              sourceName: null,
              targetIncidentId: null,
              evidence: {},
            };
      }
    }
    const final = result(base, decision, startedAt);
    if (final.action !== 'NONE')
      addOperationalMetric('opsknight_prepaging_decisions_total', 1, {
        control: final.control ?? 'NONE',
        action: final.action,
        mode: final.mode,
      });
    return final;
  } catch {
    return failOpen('error', policy.mode, startedAt, policy.revision, policyVersionId);
  } finally {
    if (timer) clearTimeout(timer);
    observeOperationalHistogram(
      'opsknight_prepaging_evaluation_seconds',
      (performance.now() - startedAt) / 1000
    );
  }
}
