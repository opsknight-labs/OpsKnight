/**
 * War-Room API endpoint
 * Handles manual war-room creation and archival from the incident detail page
 */

import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { createIncidentWarRoom, archiveWarRoomChannel } from '@/lib/chatops/war-room';
import { getUserPermissions, assertCanModifyIncident } from '@/lib/rbac';

export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(
        new AppError({
          code: 'INVALID_JSON',
          userMessage: 'Please check your input and try again.',
        })
      );
    }

    const permissions = await getUserPermissions();
    if (!permissions.authenticated) {
      return jsonError(
        new AppError({
          code: 'AUTHENTICATION_REQUIRED',
          userMessage: 'Authentication required',
        })
      );
    }

    const incidentId =
      body && typeof body === 'object' && 'incidentId' in body
        ? (body as { incidentId?: unknown }).incidentId
        : undefined;
    const action =
      body && typeof body === 'object' && 'action' in body
        ? (body as { action?: unknown }).action
        : undefined;

    if (typeof incidentId !== 'string' || typeof action !== 'string') {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: 'Missing incidentId or action',
          fields: [
            ...(typeof incidentId === 'string'
              ? []
              : [{ field: 'incidentId', code: 'required', message: 'incidentId is required' }]),
            ...(typeof action === 'string'
              ? []
              : [{ field: 'action', code: 'required', message: 'action is required' }]),
          ],
        })
      );
    }

    // Authenticated is not sufficient — creating or archiving a war-room is an
    // incident mutation, so require modify rights on this specific incident.
    try {
      await assertCanModifyIncident(incidentId);
    } catch (error) {
      if (isAppError(error)) return jsonError(error);
      throw error;
    }

    if (action === 'create') {
      // Explicit operator action — not subject to the auto-creation thresholds
      const result = await createIncidentWarRoom(incidentId, { force: true });
      if (!result.success) {
        return jsonError(
          new AppError({
            code: 'VALIDATION_FAILED',
            userMessage: result.error || 'Unable to create war-room',
          })
        );
      }
      return jsonOk(result, 200);
    }

    if (action === 'archive') {
      // Explicit operator action — not subject to the archiveOnResolve setting
      const result = await archiveWarRoomChannel(incidentId, { force: true });
      if (!result.success) {
        return jsonError(
          new AppError({
            code: 'VALIDATION_FAILED',
            userMessage: result.error || 'Unable to archive war-room',
          })
        );
      }
      return jsonOk(result, 200);
    }

    return jsonError(
      new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: 'Unknown action. Use "create" or "archive".',
        fields: [{ field: 'action', code: 'invalid', message: 'Use "create" or "archive".' }],
      })
    );
  } catch (error: unknown) {
    logger.error('[ChatOps] War-room API error', {
      error: error instanceof Error ? error.message : String(error),
      errorCode: isAppError(error) ? error.code : 'INTERNAL_ERROR',
    });
    if (isAppError(error)) return jsonError(error);
    return jsonError('Internal server error', 500);
  }
}
