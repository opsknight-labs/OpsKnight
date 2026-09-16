import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { assertCanViewIncident, assertCanModifyIncident } from '@/lib/rbac';
import { requestSlackWarRoom } from '@/lib/war-room/providers/slack/provision';
import { requestMicrosoftTeamsWarRoom } from '@/lib/war-room/providers/microsoft-teams/provision';
import {
  closeWarRoomNeutral,
  requestWarRoomProjectionNeutral,
  syncWarRoomParticipants,
  reconcileWarRoom,
} from '@/lib/war-room/engine';

/** Provider-neutral incident collaboration projection for the War Room panel. */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await assertCanViewIncident(id);
    const rooms = await prisma.incidentWarRoom.findMany({
      where: { incidentId: id },
      orderBy: [{ provider: 'asc' }, { generation: 'desc' }],
      select: {
        id: true,
        provider: true,
        generation: true,
        state: true,
        providerChannelName: true,
        providerChannelUrl: true,
        membershipType: true,
        readyAt: true,
        closedAt: true,
        archivedAt: true,
        lastError: true,
        lastErrorCode: true,
        participants: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            userId: true,
            source: true,
            state: true,
            lastError: true,
            addedAt: true,
            user: { select: { name: true } },
          },
        },
      },
    });
    return jsonOk({ rooms });
  } catch (error) {
    return jsonError(
      isAppError(error)
        ? error
        : new AppError({
            code: 'INTERNAL_ERROR',
            userMessage: 'Unable to load incident war rooms.',
          })
    );
  }
}

/** Provider-neutral create and manage endpoint for incident war rooms */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: incidentId } = await context.params;
    await assertCanModifyIncident(incidentId);

    let body: Record<string, unknown> | null = null;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return jsonError(
        new AppError({
          code: 'INVALID_JSON',
          userMessage: 'Please provide valid JSON input.',
        })
      );
    }

    const action = typeof body?.action === 'string' ? body.action : undefined;
    const provider = typeof body?.provider === 'string' ? body.provider : undefined;
    const roomId = typeof body?.roomId === 'string' ? body.roomId : undefined;

    // 1. CREATE ACTION
    if (action === 'CREATE') {
      if (!provider || !['SLACK', 'MICROSOFT_TEAMS'].includes(provider)) {
        return jsonError(
          new AppError({
            code: 'VALIDATION_FAILED',
            userMessage: 'A valid provider (SLACK or MICROSOFT_TEAMS) is required.',
          })
        );
      }

      // Check if there is already an active or in-progress room for this provider
      const existingActive = await prisma.incidentWarRoom.findFirst({
        where: {
          incidentId,
          provider,
          state: { in: ['PROVISIONING', 'AMBIGUOUS', 'READY', 'CLOSING'] },
        },
        select: { id: true, state: true },
      });

      if (existingActive) {
        return jsonError(
          new AppError({
            code: 'INCIDENT_STATE_CONFLICT',
            userMessage: `An active or provisioning war room already exists for ${provider}.`,
          })
        );
      }

      if (provider === 'SLACK') {
        const result = await requestSlackWarRoom(incidentId, {
          manual: true,
          allowNewGeneration: true,
        });

        if (!result.accepted) {
          return jsonError(
            new AppError({
              code: 'VALIDATION_FAILED',
              userMessage: `Failed to create Slack war room: ${result.code}`,
            })
          );
        }

        return jsonOk({ success: true, warRoomId: result.warRoomId, state: result.state }, 202);
      }

      if (provider === 'MICROSOFT_TEAMS') {
        const result = await requestMicrosoftTeamsWarRoom(incidentId, {
          manual: true,
          allowNewGeneration: true,
        });

        if (!result.accepted) {
          return jsonError(
            new AppError({
              code: 'VALIDATION_FAILED',
              userMessage: `Failed to create Microsoft Teams war room: ${result.code}`,
            })
          );
        }

        return jsonOk({ success: true, warRoomId: result.warRoomId, state: result.state }, 202);
      }
    }

    // 2. ROOM-SPECIFIC ACTIONS (CLOSE, REFRESH_PROJECTION, SYNC_PARTICIPANTS, RECONCILE)
    if (!roomId || typeof roomId !== 'string') {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: 'roomId is required for this action.',
        })
      );
    }

    // Ensure room belongs to incident
    const room = await prisma.incidentWarRoom.findFirst({
      where: { id: roomId, incidentId },
      select: { id: true, provider: true, state: true },
    });

    if (!room) {
      return jsonError(
        new AppError({
          code: 'RESOURCE_NOT_FOUND',
          userMessage: 'War room not found for this incident.',
        })
      );
    }

    if (action === 'CLOSE') {
      const closed = await closeWarRoomNeutral({ incidentId, warRoomId: roomId });
      return jsonOk({ success: closed });
    }

    if (action === 'REFRESH_PROJECTION') {
      const version = await requestWarRoomProjectionNeutral(roomId);
      return jsonOk({ success: version !== null, version });
    }

    if (action === 'SYNC_PARTICIPANTS') {
      await syncWarRoomParticipants(roomId);
      return jsonOk({ success: true });
    }

    if (action === 'RECONCILE') {
      await reconcileWarRoom(roomId);
      return jsonOk({ success: true });
    }

    return jsonError(
      new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: `Unknown action: ${action}`,
      })
    );
  } catch (error) {
    return jsonError(
      isAppError(error)
        ? error
        : new AppError({
            code: 'INTERNAL_ERROR',
            userMessage: 'Failed to process war room action.',
          })
    );
  }
}
