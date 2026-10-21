import 'server-only';
import type { Prisma } from '@prisma/client';
import { validateCustomFieldValue } from '@/lib/custom-fields';
import { AppError } from '@/lib/errors';

export async function setIncidentCustomField(
  tx: Prisma.TransactionClient,
  incidentId: string,
  customFieldId: string,
  value: string | number | boolean | null
) {
  await tx.$queryRaw`SELECT id FROM "Incident" WHERE id = ${incidentId} FOR UPDATE`;
  const field = await tx.customField.findUnique({ where: { id: customFieldId } });
  if (!field) throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Custom field not found.' });
  const validation = validateCustomFieldValue(field, value);
  if (!validation.valid) {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: validation.error ?? 'Invalid custom field value.',
    });
  }
  const existing = await tx.customFieldValue.findUnique({
    where: { incidentId_customFieldId: { incidentId, customFieldId } },
  });
  if (existing?.value === validation.normalizedValue) {
    return { ...existing, changed: false };
  }
  const updated = await tx.customFieldValue.upsert({
    where: { incidentId_customFieldId: { incidentId, customFieldId } },
    create: { incidentId, customFieldId, value: validation.normalizedValue },
    update: { value: validation.normalizedValue },
  });
  await tx.incidentEvent.create({
    data: { incidentId, type: 'LEGACY_OTHER', message: `Custom field "${field.name}" updated` },
  });
  return { ...updated, changed: true };
}
