'use server';

import { z } from 'zod/v4';
import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { assertCapability, getCurrentAuthorizationActor } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import { serviceReadWhere } from '@/lib/authorization-filters';
import { resolveEffectivePolicy } from '@/lib/intelligence/settings/service';
import { evaluateServiceQuality } from '@/lib/intelligence/evaluation/quality';

export interface QualityActionState {
  ok: boolean;
  message: string;
}
const input = z
  .object({
    serviceId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    kind: z.enum(['SHADOW', 'CERTIFICATION']),
  })
  .strict();

export async function measureQualityAction(
  _state: QualityActionState,
  form: FormData
): Promise<QualityActionState> {
  try {
    const user = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const actor = await getCurrentAuthorizationActor();
    const parsed = input.safeParse({ serviceId: form.get('serviceId'), kind: form.get('kind') });
    if (!parsed.success) return { ok: false, message: 'Choose a service and evaluation kind.' };
    const service = await prisma.service.findFirst({
      where: { AND: [{ id: parsed.data.serviceId }, serviceReadWhere(actor)] },
      select: { id: true },
    });
    if (!service) return { ok: false, message: 'That service is not available.' };
    const result = await evaluateServiceQuality(
      service.id,
      await resolveEffectivePolicy(service.id),
      { actorId: user.id, source: 'UI' },
      parsed.data.kind === 'CERTIFICATION'
    );
    revalidatePath('/settings/intelligence/quality');
    revalidatePath('/settings/intelligence/services');
    return {
      ok: true,
      message: `${result.metrics.sampleCount} reviewed pairs measured. ${parsed.data.kind === 'CERTIFICATION' ? result.reason : 'Shadow measurement saved; no mode was changed.'}`,
    };
  } catch {
    return { ok: false, message: 'Quality evaluation could not finish. No mode was changed.' };
  }
}
