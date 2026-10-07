import { z } from 'zod';

export const LIMITS = { fields: 64, depth: 12, stringBytes: 2048, enumBytes: 256, aliases: 200, rules: 100, conditions: 20, actions: 8, evaluationMs: 15, cache: 256 } as const;
export const PRIORITIES = ['P1', 'P2', 'P3', 'P4', 'P5'] as const;
export type Scalar = string | number | boolean;
export type FieldState = { state: 'MISSING' } | { state: 'UNMAPPED'; raw: Scalar } | { state: 'RECOGNIZED'; value: Scalar };
export type Context = Record<string, FieldState>;
export type Truth = 'TRUE' | 'FALSE' | 'UNKNOWN';
export const scalarSchema = z.union([z.string().max(2048), z.number().finite(), z.boolean()]);
const identifier = z.string().min(1).max(100);
export const fieldSchema = z.object({
  fieldId: identifier, key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), label: z.string().min(1).max(100),
  type: z.enum(['STRING', 'ENUM', 'NUMBER', 'BOOLEAN']), caseSensitive: z.boolean().default(false),
  allowedValues: z.array(z.string().min(1).max(256)).max(200).optional(),
  aliases: z.record(z.string().max(256)).default({}),
  mappings: z.array(z.object({ source: z.enum(['PROVIDER', 'EVENT']), integrationType: z.string().max(64).optional(), path: z.string().min(1).max(512) }).strict()).max(32).default([]),
}).strict();
export const conditionSchema = z.object({ fieldKey: z.string().min(1).max(64), operator: z.enum(['EQ', 'NE', 'IN', 'NOT_IN', 'LT', 'LTE', 'GT', 'GTE', 'IS_SET', 'IS_MISSING', 'IS_UNMAPPED']), value: z.union([scalarSchema, z.array(scalarSchema).max(200)]).optional() }).strict();
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('SET_PRIORITY'), value: z.enum(PRIORITIES) }).strict(),
  z.object({ type: z.literal('SET_CONTEXT'), fieldKey: z.string().min(1).max(64), value: scalarSchema }).strict(),
  z.object({ type: z.literal('ADD_TAG'), value: z.string().min(1).max(64) }).strict(),
  z.object({ type: z.literal('USE_SERVICE_DEFAULT') }).strict(),
  z.object({ type: z.literal('USE_ESCALATION_POLICY'), policyId: identifier }).strict(),
  z.object({ type: z.literal('NO_ESCALATION') }).strict(),
  z.object({ type: z.literal('NOTIFY_CHANNEL'), provider: z.enum(['SLACK', 'TEAMS']), destinationId: identifier }).strict(),
]);
export const ruleSchema = z.object({ id: identifier, name: z.string().min(1).max(100), phase: z.enum(['ENRICH', 'ROUTE']), enabled: z.boolean().default(true), conditions: z.array(conditionSchema).max(LIMITS.conditions), actions: z.array(actionSchema).min(1).max(LIMITS.actions) }).strict();
export const snapshotSchema = z.object({ schemaVersion: z.literal(1), fields: z.array(fieldSchema).max(LIMITS.fields), rules: z.array(ruleSchema).max(LIMITS.rules) }).strict();
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Field = z.infer<typeof fieldSchema>;
export type Condition = z.infer<typeof conditionSchema>;
export type Action = z.infer<typeof actionSchema>;
export type Rule = z.infer<typeof ruleSchema>;
export type CompiledField = Field & { mappings: Array<Field['mappings'][number] & { pathTokens: Array<string | number> }> };
export type CompiledSnapshot = Omit<Snapshot, 'fields'> & { fields: CompiledField[] };
export type Route = { type: 'SERVICE_DEFAULT' } | { type: 'ESCALATION_POLICY'; policyId: string } | { type: 'NO_ESCALATION' };
export type SupplementalAction = Extract<Action, { type: 'NOTIFY_CHANNEL' }> & { ruleId: string };
export const emptySnapshot: Snapshot = { schemaVersion: 1, fields: [], rules: [] };
export const builtinFields: Field[] = [
  { fieldId: 'priority', key: 'priority', label: 'Priority', type: 'ENUM', caseSensitive: true, allowedValues: [...PRIORITIES], aliases: {}, mappings: [] },
  ...['urgency', 'severity', 'integration', 'source'].map(key => ({ fieldId: key, key, label: key[0].toUpperCase() + key.slice(1), type: 'STRING' as const, caseSensitive: false, aliases: {}, mappings: [] })),
];
