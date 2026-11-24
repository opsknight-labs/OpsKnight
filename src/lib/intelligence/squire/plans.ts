import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import { decrypt, encrypt } from '@/lib/encryption';
import { logAudit } from '@/lib/audit';
import { logger } from '@/lib/logger';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { isMcpApprovalGated } from '@/lib/mcp/catalog';
import { validateOperationArgs } from '@/lib/mcp/core/execution';
import { McpBoundaryError } from '@/lib/mcp/core/errors';
import type { AiToolDefinition } from '../ai/port';
import { redactSecrets } from '../ai/redact';
import type { SquireProposal } from './actions/catalog';
import { actionLabel } from './actions/history';
import { UNKNOWN_ACTION_MESSAGE, type SquireActionResult } from './actions/outcomes';
import { readIncidentForActor } from './deterministic';
import {
  argsSchema,
  buildOperationProposal,
  changesOf,
  displayName,
  extendedOn,
  incidentOf,
  invoke,
  isHighRisk,
  isReadOperation,
  mayCall,
  receiptRefusal,
  refusal,
  rolesAllowing,
  squireOperation,
  summaryOf,
  webPath,
  type OperationArgs,
} from './operations';

/**
 * Multi-step change plans: several operation-catalog changes on one card, confirmed once, applied in order
 * as the person and stopped at the first failure. Each step is exactly what propose_operation would run
 * (same catalog gate, role check, validation and REST handler); a step may use an earlier step's result
 * through a `{"$from": "<index>", "pointer": "/json/pointer"}` reference, resolved only at execution.
 * There is no rollback: steps already applied stay applied, and the result says so.
 * A high-risk change (R3) is never a plan step: it always gets its own card. A reference may only fill the
 * path of a step that creates something; an update or delete always shows its real target id on the card.
 */

export const PROPOSE_PLAN_TOOL: AiToolDefinition = {
  name: 'propose_plan',
  description:
    'Suggest several related changes from find_operations as one plan (for example create a service, then its escalation policy, then a maintenance window). Pass { title, steps: [{ operationId, args }] } with 2 to 5 steps; a later step may use an earlier step\'s result with {"$from": "<0-based step index>", "pointer": "/data/id"} (a JSON pointer into that step\'s response). A reference may fill the path only of a create step. High-risk changes such as deletes cannot be in a plan; propose them on their own. The user sees one card listing every step and decides; nothing happens unless they confirm.',
  kind: 'PROPOSE_WRITE',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', maxLength: 120 },
      steps: {
        type: 'array',
        minItems: 2,
        maxItems: 5,
        items: {
          type: 'object',
          properties: {
            operationId: { type: 'string', maxLength: 80 },
            args: { type: 'object' },
          },
          required: ['operationId', 'args'],
          additionalProperties: false,
        },
      },
    },
    required: ['title', 'steps'],
    additionalProperties: false,
  },
};

const TTL_MS = 10 * 60_000;
const MAX_DEPTH = 16;

const inputSchema = z
  .object({ title: z.string().trim().min(1).max(120), steps: z.array(argsSchema).min(2).max(5) })
  .strict();

const sealedSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal('plan'),
    id: z.string().uuid(),
    title: z.string().max(120),
    steps: z
      .array(
        z
          .object({ operationId: z.string().max(80), args: z.record(z.string(), z.unknown()) })
          .strict()
      )
      .min(2)
      .max(5),
    actorId: z.string().max(64),
    exp: z.number(),
  })
  .strict();
type SealedPlan = z.infer<typeof sealedSchema>;

/** Replaces every `$from` reference in a step's args with `resolve(stepIndex, pointer)`. Throws on a malformed one. */
function mapReferences(
  value: unknown,
  step: number,
  resolve: (from: number, pointer: string) => unknown,
  depth = 0
): unknown {
  if (!value || typeof value !== 'object') return value;
  if (depth > MAX_DEPTH) throw new Error('nested too deeply');
  if (Array.isArray(value)) return value.map(item => mapReferences(item, step, resolve, depth + 1));
  if (!Object.hasOwn(value, '$from'))
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        mapReferences(child, step, resolve, depth + 1),
      ])
    );
  const { $from: from, pointer, ...rest } = value as Record<string, unknown>;
  const index =
    typeof from === 'number' ? from : typeof from === 'string' && /^\d$/.test(from) ? +from : NaN;
  if (
    Object.keys(rest).length ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= step ||
    typeof pointer !== 'string' ||
    pointer.length > 256 ||
    (pointer !== '' && !pointer.startsWith('/'))
  )
    throw new Error('malformed reference');
  return resolve(index, pointer);
}

/** The RFC 6901 pointer's value in a response, or throws when nothing usable is there. */
function at(response: unknown, pointer: string): unknown {
  let target = response;
  for (const token of pointer === '' ? [] : pointer.slice(1).split('/')) {
    const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
    const found =
      target && typeof target === 'object'
        ? Array.isArray(target)
          ? /^(0|[1-9]\d*)$/.test(key) && Number(key) < target.length
          : Object.hasOwn(target, key)
        : false;
    if (!found) throw new Error('pointer finds nothing');
    // eslint-disable-next-line security/detect-object-injection -- own key or in-range index, checked above
    target = (target as Record<string, unknown>)[key];
  }
  if (target === null || target === undefined || typeof target === 'object')
    throw new Error('pointer finds no value');
  return target;
}

/** A POST that adds a record (createX, addX): the only kind of step whose path may come from an earlier step. */
const createsRecord = (operation: { method: string; operationId: string }) =>
  operation.method === 'post' && /^(create|add)[A-Z]/.test(operation.operationId);

/**
 * Checks every step as at proposal time: a change this person may make, valid with each reference stood in
 * by a readable placeholder ("from-step-1"). Returns the steps and their placeholder args, or null.
 * shortcut: the placeholder is a string, so a reference into a numeric field is refused; type it if needed.
 */
function checkSteps(actor: AuthorizationActor, steps: SealedPlan['steps']) {
  try {
    return steps.map(({ operationId, args }, index) => {
      const operation = squireOperation(operationId);
      if (
        !operation ||
        isReadOperation(operation) ||
        isHighRisk(operation) ||
        !mayCall(actor, operation)
      )
        throw new Error();
      if (!createsRecord(operation))
        mapReferences(args.path, index, () => {
          throw new Error('a reference in the target of an update');
        });
      const shown = mapReferences(args, index, from => `from-step-${from + 1}`);
      return {
        operation,
        args,
        shown: validateOperationArgs(operationId, shown, isMcpApprovalGated(operation)),
      };
    });
  } catch {
    return null;
  }
}

/** Builds the plan card, or null when any step is not a change this person could make. */
export async function buildPlanProposal(
  actor: AuthorizationActor,
  rawInput: unknown,
  now: Date = new Date()
): Promise<(SquireProposal & { href?: string }) | null> {
  if (actor.apiKey || actor.status !== 'ACTIVE' || !(await extendedOn())) return null;
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) return null;
  const id = randomUUID();
  const steps = checkSteps(
    actor,
    parsed.data.steps.map((step, index) => ({
      operationId: step.operationId,
      args: { ...step.args, idempotencyKey: `squire-${id}-${index}` },
    }))
  );
  if (!steps) return null;
  const sealed: SealedPlan = {
    v: 1,
    kind: 'plan',
    id,
    title: parsed.data.title,
    steps: steps.map(({ operation, args }) => ({ operationId: operation.operationId, args })),
    actorId: actor.id,
    exp: now.getTime() + TTL_MS,
  };
  const preview = steps.map(({ operation, shown }, index) => {
    const fields = [
      ...Object.entries(shown.path ?? {}).map(([key, value]) => `${key} ${value}`),
      ...changesOf(operation, shown).map(([field, value]) => `${field} = ${value}`),
    ];
    return {
      label: `Step ${index + 1} · ${summaryOf(operation)}`.slice(0, 64),
      value: (fields.join('; ') || 'No fields').slice(0, 1_000),
    };
  });
  return {
    token: await encrypt(JSON.stringify(sealed)),
    receiptId: id,
    action: 'run_plan' as SquireProposal['action'],
    kind: 'WRITE',
    title: `Plan: ${parsed.data.title}`.slice(0, 120),
    detail: `${steps.length} changes, applied in order as you, with your permissions. It stops at the first failure; changes already made stay (nothing is rolled back).`,
    expiresAt: new Date(sealed.exp).toISOString(),
    confirmLabel: 'Apply all',
    href: webPath(steps[0].operation, steps[0].shown.path),
    preview,
  };
}

/** The sealed plan in a confirm token, or null when the token is not a plan (or not this person's). */
export async function openPlanProposal(
  token: string,
  actorId: string,
  now: Date = new Date()
): Promise<SealedPlan | null> {
  try {
    const parsed = sealedSchema.safeParse(JSON.parse(await decrypt(token)));
    if (!parsed.success || parsed.data.actorId !== actorId || parsed.data.exp <= now.getTime())
      return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/** Runs a confirmed plan once, in order, stopping at the first failure. The receipt makes it single-use. */
export async function executePlanProposal(
  actor: AuthorizationActor,
  sealed: SealedPlan
): Promise<SquireActionResult> {
  const fail = (message: string): SquireActionResult => ({ ok: false, message });
  if (actor.apiKey || actor.status !== 'ACTIVE') return fail('Sign in to confirm this change.');
  if (!(await extendedOn()))
    return fail('This kind of action is turned off. Ask an administrator to enable it.');
  const steps = checkSteps(actor, sealed.steps);
  if (!steps)
    return fail('Your role does not allow every change in this plan, or it is no longer valid.');
  const context = { name: await displayName(actor.id) };
  const incidentIds = [
    ...new Set(steps.flatMap(step => incidentOf(step.operation, step.args) ?? [])),
  ];
  try {
    await prisma.squireActionReceipt.create({
      data: {
        id: sealed.id,
        userId: actor.id,
        action: `plan:${steps.length} steps`,
        incidentId: incidentIds[0],
        incidentIds,
        status: 'RUNNING',
        startedAt: new Date(),
        intentEncrypted: await encrypt(
          JSON.stringify({ v: 1, title: sealed.title, steps: sealed.steps })
        ),
      },
    });
  } catch (error) {
    return fail(receiptRefusal(error));
  }
  // eslint-disable-next-line security/detect-object-injection -- a step index below steps.length
  const name = (index: number) => `step ${index + 1} (${summaryOf(steps[index].operation)})`;
  const responses: unknown[] = [];
  let failure: { status: 'FAILED' | 'UNKNOWN'; why: string } | null = null;
  for (const [index, step] of steps.entries()) {
    let args: OperationArgs;
    try {
      args = validateOperationArgs(
        step.operation.operationId,
        // eslint-disable-next-line security/detect-object-injection -- index of an earlier step, checked
        mapReferences(step.args, index, (from, pointer) => at(responses[from], pointer)),
        isMcpApprovalGated(step.operation)
      );
    } catch {
      failure = { status: 'FAILED', why: 'a value it needed from an earlier step was missing' };
      break;
    }
    try {
      responses.push(await invoke(actor, step.operation, args, context));
    } catch (error) {
      logger.warn('[Squire] Confirmed plan step was refused', {
        operationId: step.operation.operationId,
        error: error instanceof McpBoundaryError ? error.code : 'error',
      });
      // A refusal is definite; anything else may have applied, so it is reported as unknown, never retried.
      failure =
        error instanceof McpBoundaryError
          ? { status: 'FAILED', why: refusal(error) }
          : { status: 'UNKNOWN', why: UNKNOWN_ACTION_MESSAGE };
      break;
    }
  }
  const done = responses.length;
  const list = (from: number, to: number) =>
    Array.from({ length: to - from }, (_, offset) => name(from + offset)).join(', ');
  const status = failure?.status ?? 'SUCCEEDED';
  const message = (
    failure
      ? [
          done ? `Done: ${list(0, done)}.` : 'Nothing was changed.',
          `Failed: ${name(done)}: ${failure.why}`,
          done + 1 < steps.length ? `Not attempted: ${list(done + 1, steps.length)}.` : '',
          done ? 'The changes already made were not rolled back.' : '',
        ]
      : [`Done: ${list(0, done)}.`]
  )
    .filter(Boolean)
    .join(' ')
    .slice(0, 2_000);
  const result: SquireActionResult = failure
    ? fail(message)
    : { ok: true, message, href: webPath(steps[0].operation, steps[0].shown.path) };
  await prisma.squireActionReceipt
    .update({
      where: { id: sealed.id },
      data: {
        status,
        completedAt: new Date(),
        ...(status === 'FAILED' ? { failureCode: 'DOMAIN_REJECTED' } : {}),
        ...(status === 'UNKNOWN' ? { failureCode: 'EXECUTION_UNCERTAIN' } : {}),
        resultEncrypted: status === 'UNKNOWN' ? null : await encrypt(JSON.stringify(result)),
      },
    })
    .catch(() => undefined);
  await logAudit({
    action: 'intelligence.squire.plan',
    entityType: 'SYSTEM_CONFIG',
    entityId: sealed.id,
    actorId: actor.id,
    source: 'UI',
    details: {
      operationIds: steps.map(step => step.operation.operationId),
      completed: done,
      outcome: status,
    },
  }).catch(() => undefined);
  return result;
}

// ── Fix → runbook ─────────────────────────────────────────────────────────────────────────────────────

export const PROPOSE_RUNBOOK_FROM_FIX_TOOL: AiToolDefinition = {
  name: 'propose_runbook_from_fix',
  description:
    'Offer to turn how a resolved incident was fixed into a draft runbook (after it is resolved, or when a resolved incident is in view). Pass { incidentId }; Squire drafts manual steps from its notes, resolution and the actions confirmed in Squire. You may refine them with { name, steps: [{ name, description }] } (1 to 12 steps) using only what the timeline shows. The user sees the steps and decides; confirming creates an unpublished draft.',
  kind: 'PROPOSE_WRITE',
  inputSchema: {
    type: 'object',
    properties: {
      incidentId: { type: 'string', maxLength: 64 },
      name: { type: 'string', maxLength: 120 },
      steps: {
        type: 'array',
        minItems: 1,
        maxItems: 12,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', maxLength: 200 },
            description: { type: 'string', maxLength: 2000 },
          },
          required: ['name'],
          additionalProperties: false,
        },
      },
    },
    required: ['incidentId'],
    additionalProperties: false,
  },
};

const fixStepSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2_000).optional(),
  })
  .strict();
export const runbookFromFixInput = z
  .object({
    incidentId: z.string().min(1).max(64),
    name: z.string().trim().min(1).max(120).optional(),
    steps: z.array(fixStepSchema).min(1).max(12).optional(),
  })
  .strict();
type FixStep = z.infer<typeof fixStepSchema>;

/** Timeline entries that say what someone did, not lifecycle bookkeeping. */
const FIX_EVENT_TYPES = ['COMMENT', 'RUNBOOK_COMPLETED', 'MANUAL_RESOLVED'] as const;

/**
 * Manual runbook steps for how a resolved incident the person can read was fixed: check the symptom, then
 * the notes and Squire actions in the order they happened, then the resolution. Null when not resolved.
 */
export async function draftRunbookFromFix(actor: AuthorizationActor, incidentId: string) {
  const incident = await readIncidentForActor(actor, incidentId);
  if (!incident || incident.status !== 'RESOLVED') return null;
  const [events, receipts] = await Promise.all([
    prisma.incidentEvent.findMany({
      where: { incidentId, type: { in: [...FIX_EVENT_TYPES] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 20,
      select: { type: true, message: true, createdAt: true },
    }),
    prisma.squireActionReceipt.findMany({
      where: { status: 'SUCCEEDED', OR: [{ incidentId }, { incidentIds: { has: incidentId } }] },
      orderBy: { createdAt: 'asc' },
      take: 20,
      select: { action: true, createdAt: true },
    }),
  ]);
  const text = (message: string) => redactSecrets(message).trim().slice(0, 2_000);
  const resolution = events.findLast(event => event.type === 'MANUAL_RESOLVED');
  const done = [
    ...events
      .filter(event => event.type !== 'MANUAL_RESOLVED')
      .map(event => ({ at: event.createdAt, name: text(event.message).slice(0, 200) })),
    // Only the action's label: the confirmed arguments and outcome text stay with the person who confirmed.
    ...receipts
      .filter(receipt => !/resolve_?incident$/i.test(receipt.action))
      .map(receipt => ({ at: receipt.createdAt, name: actionLabel(receipt.action).slice(0, 200) })),
  ]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .filter((step, index, all) => step.name && all.findIndex(o => o.name === step.name) === index)
    .slice(0, 10);
  const steps: FixStep[] = [
    {
      name: 'Confirm the symptom',
      description: text(
        `Check for what was seen in "${incident.title}" on ${incident.serviceName}.`
      ),
    },
    ...done.map(({ name }) => ({ name })),
    {
      name: 'Confirm the fix holds',
      description: resolution
        ? text(resolution.message)
        : 'Check the symptom is gone before resolving.',
    },
  ];
  return { incident, steps };
}

/**
 * The "Turn this fix into a runbook" card: an unpublished runbook draft made through the catalog's own
 * createRunbook operation, so the same role check, confirmation and receipt apply as for any change.
 * Returns a refusal in words (naming the role it needs) when there is no card to offer.
 */
export async function buildRunbookFromFixProposal(
  actor: AuthorizationActor,
  rawInput: unknown,
  now: Date = new Date()
): Promise<(SquireProposal & { href?: string }) | { refusal: string }> {
  const operation = squireOperation('createRunbook');
  if (operation && !mayCall(actor, operation))
    return {
      refusal: `Turning a fix into a runbook needs ${rolesAllowing(actor, operation)}. Ask someone with that role, or an administrator to change your role. Nothing was prepared.`,
    };
  const parsed = runbookFromFixInput.safeParse(rawInput);
  const draft = parsed.success ? await draftRunbookFromFix(actor, parsed.data.incidentId) : null;
  if (!operation || !parsed.success || !draft)
    return {
      refusal:
        'Only a resolved incident you can open can be turned into a runbook. Nothing was prepared.',
    };
  const { incident } = draft;
  const steps = parsed.data.steps ?? draft.steps;
  const words = incident.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 60)
    .replace(/^-+|-+$/g, '');
  const card = await buildOperationProposal(
    actor,
    {
      operationId: 'createRunbook',
      args: {
        body: {
          name: parsed.data.name ?? `Fix: ${incident.title}`.slice(0, 120),
          slug: ['fix', words, incident.id.slice(-8).toLowerCase()].filter(Boolean).join('-'),
          description: `Drafted by Squire from how "${incident.title}" was fixed. Review before publishing.`,
          definition: {
            steps: steps.map((step, index) => ({
              key: `step_${index + 1}`,
              name: step.name,
              ...(step.description ? { description: step.description } : {}),
              type: 'MANUAL',
              riskClass: 'READ_ONLY',
              config: {},
            })),
          },
        },
      },
    },
    now,
    { target: null }
  );
  if (!card)
    return {
      refusal:
        'Runbook drafts are not available right now: an administrator may have turned off "Extended assistant actions". Nothing was prepared.',
    };
  return {
    ...card,
    title: 'Turn this fix into a runbook',
    detail: `Creates an unpublished runbook draft with ${steps.length} manual steps from how this incident was fixed. Review and publish it from Runbooks.`,
    confirmLabel: 'Create draft runbook',
    preview: steps.slice(0, 10).map((step, index) => ({
      label: `Step ${index + 1}`,
      value: [step.name, step.description].filter(Boolean).join(': ').slice(0, 1_000),
    })),
  };
}

/** The runbook card offered after a resolve, or undefined when there is none to offer. */
export async function offerRunbookFromFix(actor: AuthorizationActor, incidentId: string) {
  const card = await buildRunbookFromFixProposal(actor, { incidentId }).catch(() => null);
  return card && 'token' in card ? card : undefined;
}
