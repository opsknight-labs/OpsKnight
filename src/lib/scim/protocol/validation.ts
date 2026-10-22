/* eslint-disable security/detect-object-injection -- Attribute keys are restricted by strict SCIM schemas and explicit path allowlists. */
import { z } from 'zod';

export class ScimFailure extends Error {
  constructor(
    public status: number,
    message: string,
    public scimType = 'invalidValue'
  ) {
    super(message);
  }
}
export const enterpriseSchema = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
export const patchSchema = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
export const identifier = z.string().trim().min(1).max(320);
export const memberSchema = z
  .object({ value: identifier, display: z.string().optional(), $ref: z.string().optional() })
  .strict();
export const groupSchema = z
  .object({
    schemas: z.array(z.literal('urn:ietf:params:scim:schemas:core:2.0:Group')).min(1).optional(),
    id: identifier.optional(),
    meta: z.record(z.unknown()).optional(),
    displayName: z.string().trim().min(1).max(100),
    externalId: identifier.optional(),
    members: z.array(memberSchema).max(10000).optional(),
  })
  .strict();
export const userSchema = z
  .object({
    schemas: z
      .array(z.enum(['urn:ietf:params:scim:schemas:core:2.0:User', enterpriseSchema]))
      .min(1)
      .optional(),
    id: identifier.optional(),
    meta: z.record(z.unknown()).optional(),
    userName: z
      .string()
      .trim()
      .email()
      .max(320)
      .transform(v => v.toLowerCase()),
    externalId: identifier.optional(),
    displayName: z.string().trim().min(1).max(320).optional(),
    name: z
      .object({
        formatted: z.string().trim().max(320).optional(),
        givenName: z.string().trim().max(160).optional(),
        familyName: z.string().trim().max(160).optional(),
      })
      .strict()
      .optional(),
    emails: z
      .array(
        z
          .object({
            value: z.string().email().max(320),
            type: z.literal('work').optional(),
            primary: z.boolean().optional(),
          })
          .strict()
      )
      .max(1)
      .optional(),
    active: z.boolean().optional(),
    title: z.string().trim().max(320).nullable().optional(),
    [enterpriseSchema]: z
      .object({ department: z.string().trim().max(320).nullable().optional() })
      .strict()
      .optional(),
    photos: z
      .array(
        z
          .object({
            value: z
              .string()
              .url()
              .refine(v => /^https?:\/\//i.test(v)),
            type: z.string().optional(),
            primary: z.boolean().optional(),
          })
          .strict()
      )
      .max(1)
      .optional(),
  })
  .strict()
  .superRefine((user, ctx) => {
    if (user.emails?.[0] && user.emails[0].value.toLowerCase() !== user.userName)
      ctx.addIssue({ code: 'custom', message: 'The work email must match userName.' });
  });

/** Structural attribute names are case-insensitive; reject ambiguous duplicates. */
export function normalizeAttributes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeAttributes);
  if (!value || typeof value !== 'object') return value;
  const names: Record<string, string> = {
    username: 'userName',
    externalid: 'externalId',
    displayname: 'displayName',
    givenname: 'givenName',
    familyname: 'familyName',
    operations: 'Operations',
    [enterpriseSchema.toLowerCase()]: enterpriseSchema,
    $ref: '$ref',
  };
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    const lower = key.toLowerCase();
    const normalized = names[lower] ?? lower;
    if (normalized in result) throw new ScimFailure(400, 'Duplicate SCIM attribute.');
    result[normalized] = normalizeAttributes(val);
  }
  return result;
}
export async function readBody(request: Request): Promise<unknown> {
  // Enforce actual streamed bytes, including clients without Content-Length.
  const reader = request.body?.getReader();
  if (!reader) throw new ScimFailure(400, 'A JSON body is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) {
        await reader.cancel();
        throw new ScimFailure(413, 'SCIM payload exceeds 1 MiB.', 'tooLarge');
      }
      chunks.push(value);
    }
    return normalizeAttributes(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } catch (error) {
    if (error instanceof ScimFailure) throw error;
    throw new ScimFailure(400, 'Malformed JSON body.', 'invalidSyntax');
  }
}
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ScimFailure(
      400,
      result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
    );
  return result.data;
}
export function pagination(params: URLSearchParams) {
  const number = (key: string, fallback: number, min: number) => {
    const value = params.get(key);
    if (value === null) return fallback;
    if (!/^\d{1,10}$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min)
      throw new ScimFailure(400, `${key} must be an integer >= ${min}.`);
    return Number(value);
  };
  return { startIndex: number('startIndex', 1, 1), count: Math.min(100, number('count', 100, 0)) };
}
export function operations(body: unknown) {
  return parse(
    z
      .object({
        schemas: z.array(z.literal(patchSchema)).min(1).optional(),
        Operations: z
          .array(
            z
              .object({
                op: z
                  .string()
                  .transform(v => v.toLowerCase())
                  .pipe(z.enum(['add', 'replace', 'remove'])),
                path: z.string().trim().max(512).optional(),
                value: z.unknown().optional(),
              })
              .strict()
          )
          .min(1)
          .max(100),
      })
      .strict(),
    body
  ).Operations;
}
