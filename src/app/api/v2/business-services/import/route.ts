import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import {
  IMPORT_FORMATS,
  importBusinessServices,
  MAX_IMPORT_BYTES,
} from '@/lib/business-services/import';

/**
 * Imports business services from CSV, YAML or a Backstage catalog (at most 1000). `?dryRun=true`
 * returns the diff without writing; a real run applies all rows or none.
 */
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_CREATE,
  querySchema: z.object({ dryRun: z.enum(['true', 'false']).optional() }).strict(),
  bodySchema: z
    .object({
      format: z.enum(IMPORT_FORMATS),
      content: z.string().min(1).max(MAX_IMPORT_BYTES),
    })
    .strict(),
  idempotent: true,
  // shortcut: the apply runs in the 10 s replay transaction, so very large files may time out
  // over the API (the web importer allows 120 s); split the file if that happens.
  handler: async ({ query, body, actor, tx }) => ({
    data: await importBusinessServices(
      { content: body.content, format: body.format, dryRun: query.dryRun === 'true' },
      { actor, source: 'API' },
      tx
    ),
    headers: { 'Cache-Control': 'no-store' },
  }),
});
