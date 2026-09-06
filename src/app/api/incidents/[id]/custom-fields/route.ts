import { NextRequest } from 'next/server';
import { assertResponderOrAbove } from '@/lib/rbac';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { IncidentCustomFieldSchema } from '@/lib/validation';
import { validateCustomFieldValue } from '@/lib/custom-fields';
import { logger } from '@/lib/logger';

/**
 * Update Custom Field Value for Incident
 * POST /api/incidents/[id]/custom-fields
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: incidentId } = await params;

    try {
      await assertResponderOrAbove();
    } catch (error) {
      return jsonError(
        error instanceof Error ? error.message : 'Unauthorized to modify incident',
        403
      );
    }

    let body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      body = await req.json();
    } catch (_error) {
      return jsonError('Invalid JSON in request body.', 400);
    }
    const parsed = IncidentCustomFieldSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError('Invalid request body.', 400, { issues: parsed.error.issues });
    }
    const { customFieldId, value } = parsed.data;

    // Verify incident exists
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
    });

    if (!incident) {
      return jsonError('Incident not found', 404);
    }

    // Verify custom field exists
    const customField = await prisma.customField.findUnique({
      where: { id: customFieldId },
    });

    if (!customField) {
      return jsonError('Custom field not found', 404);
    }

    // Validate and normalize custom field value
    const validation = validateCustomFieldValue(customField, value);
    if (!validation.valid) {
      return jsonError(validation.error || 'Invalid custom field value', 400);
    }

    // Upsert custom field value
    await prisma.customFieldValue.upsert({
      where: {
        incidentId_customFieldId: {
          incidentId,
          customFieldId,
        },
      },
      update: {
        value: validation.normalizedValue,
      },
      create: {
        incidentId,
        customFieldId,
        value: validation.normalizedValue,
      },
    });

    logger.info('api.incident.custom_field.updated', { incidentId, customFieldId });
    return jsonOk({ success: true }, 200);
  } catch (error: any) {
    logger.error('api.incident.custom_field.update_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to update custom field', 500);
  }
}
