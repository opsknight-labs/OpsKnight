'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { encrypt } from '@/lib/encryption';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { assertCapability } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import {
  archiveRequest,
  DOC_SOURCE_KINDS,
  DocSourceError,
  normalizeDocFolder,
} from '@/lib/intelligence/knowledge/doc-sources/archive';
import { deleteDocSource, syncDocSource } from '@/lib/intelligence/knowledge/doc-sources/service';

export type DocSourceActionState = { message: string; ok: boolean };

const PATH = '/settings/intelligence/ai/docs';

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};

function failure(error: unknown): DocSourceActionState {
  if (error instanceof AppError) return { message: error.userMessage, ok: false };
  if (error instanceof DocSourceError) return { message: error.message, ok: false };
  logger.error('[Squire] Documentation source action failed', {
    error: error instanceof Error ? error.name : 'error',
  });
  return { message: 'Unable to save. Refresh and try again.', ok: false };
}

const sourceSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  kind: z.enum(DOC_SOURCE_KINDS),
  url: z
    .url()
    .max(500)
    .refine(value => value.startsWith('https://'), 'The address must start with https://'),
  ref: z.string().max(200),
  path: z.string().max(300),
  token: z.string().max(500),
  teamId: z.string().max(64),
});

/** Adds a documentation source. Administrators of intelligence only; the token is stored encrypted. */
export async function addDocSourceAction(
  _state: DocSourceActionState,
  form: FormData
): Promise<DocSourceActionState> {
  try {
    const user = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const parsed = sourceSchema.safeParse({
      name: text(form, 'name'),
      kind: text(form, 'kind'),
      url: text(form, 'url'),
      ref: text(form, 'ref'),
      path: text(form, 'path'),
      token: text(form, 'token'),
      teamId: text(form, 'teamId'),
    });
    if (!parsed.success) return { message: parsed.error.issues[0].message, ok: false };
    const input = parsed.data;
    const folder = normalizeDocFolder(input.path);
    archiveRequest({ kind: input.kind, url: input.url, ref: input.ref || null }, null);
    if (input.teamId && !(await prisma.team.findUnique({ where: { id: input.teamId } })))
      return { message: 'Choose an existing team.', ok: false };
    const row = await prisma.knowledgeDocSource.create({
      data: {
        name: input.name,
        kind: input.kind,
        url: input.url,
        ref: input.ref || null,
        path: folder || null,
        tokenEncrypted: input.token ? await encrypt(input.token) : null,
        teamId: input.teamId || null,
        createdById: user.id,
      },
      select: { id: true },
    });
    await logAudit({
      action: 'intelligence.doc_source.created',
      entityType: 'SYSTEM_CONFIG',
      entityId: row.id,
      actorId: user.id,
      newValue: {
        name: input.name,
        kind: input.kind,
        teamId: input.teamId || null,
        token: Boolean(input.token),
      },
    });
    revalidatePath(PATH);
    return { message: 'Source added. It syncs within a few minutes, or use Sync now.', ok: true };
  } catch (error) {
    return failure(error);
  }
}

/** Removes a source and everything Squire indexed from it. */
export async function deleteDocSourceAction(
  _state: DocSourceActionState,
  form: FormData
): Promise<DocSourceActionState> {
  try {
    const user = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const id = text(form, 'id');
    await deleteDocSource(id);
    await logAudit({
      action: 'intelligence.doc_source.deleted',
      entityType: 'SYSTEM_CONFIG',
      entityId: id,
      actorId: user.id,
    });
    revalidatePath(PATH);
    return { message: 'Source removed.', ok: true };
  } catch (error) {
    return failure(error);
  }
}

/** Syncs one source now instead of waiting for the schedule. */
export async function syncDocSourceAction(
  _state: DocSourceActionState,
  form: FormData
): Promise<DocSourceActionState> {
  try {
    await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const result = await syncDocSource(text(form, 'id'));
    revalidatePath(PATH);
    if (!result) return { message: 'A sync of this source is already running.', ok: false };
    return result.ok
      ? { message: `Synced ${result.documentCount} documents.`, ok: true }
      : { message: result.error ?? 'The sync failed.', ok: false };
  } catch (error) {
    return failure(error);
  }
}
