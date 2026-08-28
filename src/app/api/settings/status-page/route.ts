import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { assertAdmin } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { prismaToAppError } from '@/lib/prisma-errors';
import { StatusPageSettingsSchema } from '@/lib/validation';
import { logger } from '@/lib/logger';
import { Prisma } from '@prisma/client';
import { assertStatusPageNameAvailable, UniqueNameConflictError } from '@/lib/unique-names';

function statusPageUniqueError(fields: string[]) {
  if (fields.includes('subdomain')) {
    return {
      code: 'VALIDATION_FAILED' as const,
      userMessage: 'This subdomain is already in use. Please choose a different one.',
      fields: [
        {
          field: 'subdomain',
          code: 'duplicate',
          message: 'This subdomain is already in use. Please choose a different one.',
        },
      ],
    };
  }
  if (fields.includes('customDomain')) {
    return {
      code: 'VALIDATION_FAILED' as const,
      userMessage: 'This custom domain is already in use. Please choose a different one.',
      fields: [
        {
          field: 'customDomain',
          code: 'duplicate',
          message: 'This custom domain is already in use. Please choose a different one.',
        },
      ],
    };
  }
  return {
    code: 'VALIDATION_FAILED' as const,
    userMessage: 'A record with this value already exists.',
  };
}

/**
 * Update Status Page Settings
 * POST /api/settings/status-page
 */
export async function POST(req: NextRequest) {
  try {
    await assertAdmin();

    let body: unknown;
    try {
      body = await req.json();
    } catch (error) {
      return jsonError(new AppError({ code: 'INVALID_JSON', cause: error }));
    }

    const parsed = StatusPageSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: 'Invalid request body.',
          fields: parsed.error.issues.map(issue => ({
            field: issue.path.join('.') || 'request',
            code: issue.code,
            message: issue.message,
          })),
        }),
        undefined,
        { issues: parsed.error.issues }
      );
    }

    const {
      name,
      organizationName,
      subdomain,
      customDomain,
      enabled,
      showServices,
      showIncidents,
      showMetrics,
      showSubscribe,
      uptimeExcellentThreshold,
      uptimeGoodThreshold,
      footerText,
      contactEmail,
      contactUrl,
      branding,
      serviceIds = [],
      serviceConfigs = {},
      privacyMode,
      showIncidentDetails,
      showIncidentTitles,
      showIncidentDescriptions,
      showAffectedServices,
      showIncidentTimestamps,
      showServiceMetrics,
      showServiceDescriptions,
      showServiceRegions,
      showServicesByRegion,
      showServiceOwners,
      showServiceSlaTier,
      showTeamInformation,
      showCustomFields,
      showIncidentAssignees,
      showIncidentUrgency,
      showUptimeHistory,
      showRecentIncidents,
      showChangelog,
      showRegionHeatmap,
      showPostIncidentReview,
      maxIncidentsToShow,
      incidentHistoryDays,
      allowedCustomFields,
      dataRetentionDays,
      requireAuth,
      authProvider,
      emailProvider,
      enableUptimeExports,
      statusApiRequireToken,
      statusApiRateLimitEnabled,
      statusApiRateLimitMax,
      statusApiRateLimitWindowSec,
    } = parsed.data;

    let statusPage = await prisma.statusPage.findFirst({});

    if (!statusPage) {
      statusPage = await prisma.statusPage.create({
        data: {
          name: name?.trim() || 'Status Page',
          organizationName: organizationName || null,
          enabled: enabled !== false,
          showServices: showServices !== false,
          showIncidents: showIncidents !== false,
          showMetrics: showMetrics !== false,
          showSubscribe: showSubscribe !== false,
        },
      });
    }

    const updateData: Prisma.StatusPageUpdateInput = {
      organizationName:
        organizationName !== undefined
          ? organizationName && organizationName.trim()
            ? organizationName.trim()
            : null
          : undefined,
      subdomain: subdomain && subdomain.trim() ? subdomain.trim() : null,
      customDomain: customDomain && customDomain.trim() ? customDomain.trim() : null,
      enabled: enabled !== false,
      showServices: showServices !== false,
      showIncidents: showIncidents !== false,
      showMetrics: showMetrics !== false,
      showSubscribe: showSubscribe !== false,
      uptimeExcellentThreshold: uptimeExcellentThreshold ?? undefined,
      uptimeGoodThreshold: uptimeGoodThreshold ?? undefined,
      footerText: footerText && footerText.trim() ? footerText.trim() : null,
      contactEmail: contactEmail && contactEmail.trim() ? contactEmail.trim() : null,
      contactUrl: contactUrl && contactUrl.trim() ? contactUrl.trim() : null,
    };

    if (name !== undefined && name !== null && name.trim().length > 0) {
      try {
        const uniqueName = await assertStatusPageNameAvailable(name, { excludeId: statusPage.id });
        updateData.name = uniqueName;
      } catch (error) {
        if (error instanceof UniqueNameConflictError) {
          return jsonError(
            new AppError({
              code: 'VALIDATION_FAILED',
              userMessage: 'A status page with this name already exists.',
              fields: [
                {
                  field: 'name',
                  code: 'duplicate',
                  message: 'A status page with this name already exists.',
                },
              ],
            })
          );
        }
        return jsonError(
          new AppError({
            code: 'VALIDATION_FAILED',
            userMessage: 'Invalid status page name.',
            fields: [{ field: 'name', code: 'invalid', message: 'Invalid status page name.' }],
            cause: error,
          })
        );
      }
    }

    if (branding !== undefined) {
      updateData.branding =
        branding === null ? Prisma.JsonNull : (branding as Prisma.InputJsonValue);
    }

    if (privacyMode !== undefined) updateData.privacyMode = privacyMode;
    if (showIncidentDetails !== undefined) updateData.showIncidentDetails = showIncidentDetails;
    if (showIncidentTitles !== undefined) updateData.showIncidentTitles = showIncidentTitles;
    if (showIncidentDescriptions !== undefined)
      updateData.showIncidentDescriptions = showIncidentDescriptions;
    if (showAffectedServices !== undefined) updateData.showAffectedServices = showAffectedServices;
    if (showIncidentTimestamps !== undefined)
      updateData.showIncidentTimestamps = showIncidentTimestamps;
    if (showServiceMetrics !== undefined) updateData.showServiceMetrics = showServiceMetrics;
    if (showServiceDescriptions !== undefined)
      updateData.showServiceDescriptions = showServiceDescriptions;
    if (showServiceRegions !== undefined) updateData.showServiceRegions = showServiceRegions;
    if (showServicesByRegion !== undefined) updateData.showServicesByRegion = showServicesByRegion;
    if (showServiceOwners !== undefined) updateData.showServiceOwners = showServiceOwners;
    if (showServiceSlaTier !== undefined) updateData.showServiceSlaTier = showServiceSlaTier;
    if (showTeamInformation !== undefined) updateData.showTeamInformation = showTeamInformation;
    if (showCustomFields !== undefined) updateData.showCustomFields = showCustomFields;
    if (showIncidentAssignees !== undefined)
      updateData.showIncidentAssignees = showIncidentAssignees;
    if (showIncidentUrgency !== undefined) updateData.showIncidentUrgency = showIncidentUrgency;
    if (showUptimeHistory !== undefined) updateData.showUptimeHistory = showUptimeHistory;
    if (showRecentIncidents !== undefined) updateData.showRecentIncidents = showRecentIncidents;
    if (showChangelog !== undefined) updateData.showChangelog = showChangelog;
    if (showRegionHeatmap !== undefined) updateData.showRegionHeatmap = showRegionHeatmap;
    if (showPostIncidentReview !== undefined)
      updateData.showPostIncidentReview = showPostIncidentReview;
    if (maxIncidentsToShow !== undefined) updateData.maxIncidentsToShow = maxIncidentsToShow;
    if (incidentHistoryDays !== undefined) updateData.incidentHistoryDays = incidentHistoryDays;
    if (allowedCustomFields !== undefined) {
      updateData.allowedCustomFields =
        allowedCustomFields === null
          ? Prisma.JsonNull
          : (allowedCustomFields as Prisma.InputJsonValue);
    }
    if (dataRetentionDays !== undefined) updateData.dataRetentionDays = dataRetentionDays;
    if (requireAuth !== undefined) updateData.requireAuth = requireAuth;
    if (authProvider !== undefined) {
      updateData.authProvider = authProvider && authProvider.trim() ? authProvider.trim() : null;
    }
    if (emailProvider !== undefined) {
      updateData.emailProvider =
        emailProvider && emailProvider.trim() ? emailProvider.trim() : null;
    }
    if (enableUptimeExports !== undefined) updateData.enableUptimeExports = enableUptimeExports;
    if (statusApiRequireToken !== undefined)
      updateData.statusApiRequireToken = statusApiRequireToken;
    if (statusApiRateLimitEnabled !== undefined)
      updateData.statusApiRateLimitEnabled = statusApiRateLimitEnabled;
    if (statusApiRateLimitMax !== undefined)
      updateData.statusApiRateLimitMax = statusApiRateLimitMax;
    if (statusApiRateLimitWindowSec !== undefined)
      updateData.statusApiRateLimitWindowSec = statusApiRateLimitWindowSec;

    await prisma.statusPage.update({
      where: { id: statusPage.id },
      data: updateData,
    });

    if (Array.isArray(serviceIds)) {
      await prisma.statusPageService.deleteMany({ where: { statusPageId: statusPage.id } });

      if (serviceIds.length > 0) {
        await prisma.statusPageService.createMany({
          data: serviceIds.map((serviceId: string) => {
            const config = serviceConfigs[serviceId] || {};
            return {
              statusPageId: statusPage.id,
              serviceId,
              displayName: config.displayName || null,
              order: config.order || 0,
              showOnPage: config.showOnPage !== false,
            };
          }),
        });
      }
    }

    revalidatePath('/status');
    revalidatePath('/');

    logger.info('api.status_page.updated', { statusPageId: statusPage.id });
    return jsonOk({ success: true }, 200);
  } catch (error) {
    const prismaError = prismaToAppError(error, { unique: statusPageUniqueError });
    if (prismaError) return jsonError(prismaError);
    if (isAppError(error)) return jsonError(error);

    logger.error('api.status_page.update_error', { error });
    return jsonError('Failed to update status page', 500);
  }
}
