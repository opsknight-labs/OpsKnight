'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod/v3';
import { AppError } from '@/lib/errors';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { serviceReadWhere } from '@/lib/authorization-filters';
import prisma from '@/lib/prisma';
import {
  createBusinessServiceFromSetup,
  loadMemberSuggestions,
  type SetupInput,
} from '@/lib/business-services/setup';
import {
  importBusinessServices,
  IMPORT_FORMATS,
  type ImportPlan,
} from '@/lib/business-services/import';

function message(error: unknown, fallback: string) {
  if (error instanceof z.ZodError) return 'Check the highlighted fields.';
  if (error instanceof AppError) return error.userMessage;
  return fallback;
}

/** Services the chosen members depend on, as suggested additions. */
export async function suggestMembersAction(
  selectedIds: string[]
): Promise<Array<{ id: string; name: string }>> {
  const ids = z.array(z.string().min(1).max(100)).max(200).safeParse(selectedIds);
  if (!ids.success || !ids.data.length) return [];
  const actor = await getCurrentAuthorizationActor();
  const visible = await prisma.service.findMany({
    where: serviceReadWhere(actor),
    select: { id: true, name: true },
  });
  const suggested = await loadMemberSuggestions(ids.data, new Set(visible.map(row => row.id)));
  const names = new Map(visible.map(row => [row.id, row.name]));
  return suggested.map(id => ({ id, name: names.get(id) ?? id }));
}

export async function createFromSetupAction(
  input: SetupInput
): Promise<{ ok: true; id: string; warnings: string[] } | { ok: false; error: string }> {
  try {
    const result = await createBusinessServiceFromSetup(input, {
      actor: await getCurrentAuthorizationActor(),
    });
    revalidatePath('/services/business');
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, error: message(error, 'Could not create the business service.') };
  }
}

const importSchema = z.object({
  format: z.enum(IMPORT_FORMATS),
  content: z.string().min(1),
  dryRun: z.boolean(),
});

/** Dry run (diff) or apply of a business-service import. */
export async function importBusinessServicesAction(
  input: z.input<typeof importSchema>
): Promise<{ ok: true; result: ImportPlan & { applied: boolean } } | { ok: false; error: string }> {
  try {
    const parsed = importSchema.parse(input);
    const result = await importBusinessServices(parsed, {
      actor: await getCurrentAuthorizationActor(),
    });
    if (result.applied) revalidatePath('/services/business');
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: message(error, 'Could not read the file.') };
  }
}
