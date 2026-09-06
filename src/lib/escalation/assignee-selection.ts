/**
 * The single escalation assignment selector.
 *
 * A step's notification audience and the incident's accountable owner are
 * related but not the same thing: a step may page five schedule responders and
 * still hand ownership to exactly one of them. Every escalation code path that
 * needs an owner must call this function, so a step can never assign one
 * responder before dispatching pages and a different one afterwards.
 */
import type { EscalationTargetType } from '@prisma/client';

export type EscalationAssignment =
  | { type: 'USER'; userId: string }
  | { type: 'TEAM'; teamId: string };

export interface EscalationAssignmentInput {
  incidentId: string;
  /** Lifecycle generation, so a reopened incident can pick a different owner. */
  generation: number;
  stepIndex: number;
  targetType: EscalationTargetType;
  targetId: string;
  /** Eligible responders, as resolved by the central target resolver. */
  userIds: readonly string[];
}

function deterministicIndex(seed: string, modulus: number): number {
  // FNV-1a: a stable, dependency-free spread over the responder list. The same
  // incident + generation + step always selects the same responder, so a
  // retried or duplicated worker cannot reassign ownership.
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % modulus;
}

/**
 * Returns the owner a step should assign, or `null` when the step must page
 * without taking ownership. Callers are still responsible for not overwriting
 * an existing assignee or team.
 */
export function selectEscalationAssignment(
  input: EscalationAssignmentInput
): EscalationAssignment | null {
  // A target that reached nobody must never become an incident's owner: it
  // would look assigned on every board while no responder had been paged.
  if (input.userIds.length === 0) return null;

  if (input.targetType === 'TEAM') {
    return { type: 'TEAM', teamId: input.targetId };
  }

  if (input.targetType === 'USER') {
    return { type: 'USER', userId: input.userIds[0] };
  }

  const ordered = [...input.userIds].sort();
  const seed = `${input.incidentId}:${input.generation}:${input.stepIndex}`;
  return { type: 'USER', userId: ordered[deterministicIndex(seed, ordered.length)] };
}
