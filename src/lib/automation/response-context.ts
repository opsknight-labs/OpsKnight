import { createHash } from 'node:crypto';
import { z } from 'zod/v3';
import type { Prisma } from '@prisma/client';
import { builtinFields, LIMITS, type Context, type Field, type FieldState } from './contract';

export const RESPONSE_CONTEXT_SCHEMA_VERSION = 1;
// Built-ins plus every field authoring allows; a lower cap would silently drop declared fields.
export const RESPONSE_CONTEXT_MAX_FIELDS = builtinFields.length + LIMITS.fields;
export const RESPONSE_CONTEXT_FIELD_TYPES = ['STRING', 'ENUM', 'NUMBER', 'BOOLEAN'] as const;
export const RESPONSE_CONTEXT_STATES = ['RECOGNIZED', 'MISSING', 'UNMAPPED'] as const;

const scalar = z.union([z.string().max(2048), z.number().finite(), z.boolean()]);
const fieldSchema = z
  .object({
    fieldId: z.string().min(1).max(100),
    key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    type: z.enum(RESPONSE_CONTEXT_FIELD_TYPES),
    state: z.enum(RESPONSE_CONTEXT_STATES),
    value: scalar.nullable(),
    source: z.enum(['ALERT', 'ENRICHMENT', 'NONE']),
  })
  .strict();
export const responseContextSchema = z
  .object({
    schemaVersion: z.literal(RESPONSE_CONTEXT_SCHEMA_VERSION),
    versionId: z.string().min(1),
    versionNumber: z.number().int().nonnegative(),
    fields: z.array(fieldSchema).max(RESPONSE_CONTEXT_MAX_FIELDS),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export type ResponseContextField = z.infer<typeof fieldSchema>;
export type IncidentResponseContext = z.infer<typeof responseContextSchema>;
export type ResponseContextFieldDefinition = {
  fieldId: string;
  key: string;
  type: ResponseContextField['type'];
};

function canonicalFields(fields: ResponseContextField[]): string {
  return JSON.stringify(
    [...fields]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(f => [f.fieldId, f.key, f.type, f.state, f.value, f.source])
  );
}

export function responseContextChecksum(
  versionId: string,
  versionNumber: number,
  fields: ResponseContextField[]
): string {
  return createHash('sha256')
    .update(
      `${RESPONSE_CONTEXT_SCHEMA_VERSION}:${versionId}:${versionNumber}:${canonicalFields(fields)}`
    )
    .digest('hex');
}

function stateValue(state: FieldState | undefined): Pick<ResponseContextField, 'state' | 'value'> {
  if (!state || state.state === 'MISSING') return { state: 'MISSING', value: null };
  if (state.state === 'UNMAPPED') return { state: 'UNMAPPED', value: null };
  return { state: 'RECOGNIZED', value: state.value };
}

/** Builtins first, then the version's declared fields, deduplicated by key. */
export function responseContextFieldDefinitions(version: {
  fields: ReadonlyArray<Pick<Field, 'fieldId' | 'key' | 'type'>>;
}): ResponseContextFieldDefinition[] {
  const seen = new Set<string>();
  const definitions: ResponseContextFieldDefinition[] = [];
  for (const field of [...builtinFields, ...version.fields]) {
    if (seen.has(field.key)) continue;
    seen.add(field.key);
    definitions.push({ fieldId: field.fieldId, key: field.key, type: field.type });
  }
  if (definitions.length > RESPONSE_CONTEXT_MAX_FIELDS) throw new Error('CONTEXT_FIELD_LIMIT');
  return definitions;
}

/** Only declared schema fields are captured, so raw payload content can never enter the context. */
export function buildResponseContext(input: {
  versionId: string;
  versionNumber: number;
  fields: ResponseContextFieldDefinition[];
  inputContext: Context;
  enrichedContext: Context;
}): IncidentResponseContext {
  const fields = input.fields.map<ResponseContextField>(definition => {
    const final = stateValue(input.enrichedContext[definition.key]);
    const received = stateValue(input.inputContext[definition.key]);
    const source =
      final.state !== 'RECOGNIZED'
        ? 'NONE'
        : received.state === 'RECOGNIZED' && received.value === final.value
          ? 'ALERT'
          : 'ENRICHMENT';
    return {
      fieldId: definition.fieldId,
      key: definition.key,
      type: definition.type,
      ...final,
      source,
    };
  });
  return {
    schemaVersion: RESPONSE_CONTEXT_SCHEMA_VERSION,
    versionId: input.versionId,
    versionNumber: input.versionNumber,
    fields,
    checksum: responseContextChecksum(input.versionId, input.versionNumber, fields),
  };
}

/** Rejects anything that is not an intact, checksum-verified context. */
export function parseResponseContext(value: unknown): IncidentResponseContext | null {
  const parsed = responseContextSchema.safeParse(value);
  if (!parsed.success) return null;
  const { versionId, versionNumber, fields, checksum } = parsed.data;
  return responseContextChecksum(versionId, versionNumber, fields) === checksum
    ? parsed.data
    : null;
}

export type ResponseContextReadResult =
  | { status: 'AVAILABLE'; context: IncidentResponseContext }
  | {
      status: 'UNAVAILABLE';
      reason: 'NO_LIVE_DECISION' | 'FALLBACK' | 'NOT_CAPTURED' | 'INTEGRITY_FAILED';
    };

/**
 * The only supported way for consumers (runbooks) to read automation context.
 * SHADOW and fallback decisions never yield context, so they cannot drive execution.
 */
export async function readIncidentResponseContext(
  client: Pick<Prisma.TransactionClient, 'incidentAutomationDecision'>,
  incidentId: string
): Promise<ResponseContextReadResult> {
  const decision = await client.incidentAutomationDecision.findUnique({
    where: { incidentId },
    select: { mode: true, fallbackReason: true, responseContext: true },
  });
  if (!decision || decision.mode !== 'LIVE')
    return { status: 'UNAVAILABLE', reason: 'NO_LIVE_DECISION' };
  if (decision.fallbackReason) return { status: 'UNAVAILABLE', reason: 'FALLBACK' };
  if (decision.responseContext === null || decision.responseContext === undefined)
    return { status: 'UNAVAILABLE', reason: 'NOT_CAPTURED' };
  const context = parseResponseContext(decision.responseContext);
  return context
    ? { status: 'AVAILABLE', context }
    : { status: 'UNAVAILABLE', reason: 'INTEGRITY_FAILED' };
}

export function responseContextField(
  context: IncidentResponseContext,
  key: string
): ResponseContextField | undefined {
  return context.fields.find(field => field.key === key);
}
