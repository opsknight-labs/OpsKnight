import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { assertAdmin } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { prismaToAppError } from '@/lib/prisma-errors';
import { StatusPageSettingsSchema } from '@/lib/validation';
import { logger } from '@/lib/logger';
import { Prisma } from '@prisma/client';
import { assertStatusPageNameAvailable, UniqueNameConflictError } from '@/lib/unique-names';
import { externalizeStatusPageLogo } from '@/lib/status-pages/assets';
import { StatusPageAdminError } from '@/lib/status-pages/admin';
import { applyStatusPageConfigurationChange } from '@/lib/status-pages/publish-configuration';
import { STATUS_PAGE_SECTION_HEADER } from '@/lib/status-pages/settings-sections';

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

export async function POST(req: NextRequest) {
  try {
    const actor = await assertAdmin();

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
      id,
      expectedUpdatedAt,
      name,
      slug,
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
      serviceIds,
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
      showIncidentHistoryDetails,
      incidentHistoryDetailDays,
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

    if (!id) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: 'Status page ID is required for every administrative update.',
          fields: [{ field: 'id', code: 'required', message: 'Status page ID is required.' }],
        })
      );
    }

    const statusPage = await prisma.statusPage.findUnique({ where: { id } });
    if (!statusPage) return jsonError('Status page not found.', 404);

    const effectiveExcellent = uptimeExcellentThreshold ?? statusPage.uptimeExcellentThreshold;
    const effectiveGood = uptimeGoodThreshold ?? statusPage.uptimeGoodThreshold;
    if (effectiveExcellent < effectiveGood) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage:
            'Excellent uptime threshold must be greater than or equal to the good threshold.',
          fields: [
            {
              field: 'uptimeExcellentThreshold',
              code: 'invalid',
              message: 'Must be greater than or equal to the good threshold.',
            },
          ],
        })
      );
    }

    const hasField = (field: keyof typeof parsed.data) =>
      Object.prototype.hasOwnProperty.call(parsed.data, field);
    const nullableText = (value: string | null | undefined) => value?.trim() || null;

    const updateData: Prisma.StatusPageUpdateInput = {
      slug: hasField('slug') ? slug || null : undefined,
      organizationName: hasField('organizationName') ? nullableText(organizationName) : undefined,
      subdomain: hasField('subdomain') ? nullableText(subdomain) : undefined,
      customDomain: hasField('customDomain') ? nullableText(customDomain) : undefined,
      enabled: hasField('enabled') ? enabled : undefined,
      showServices: hasField('showServices') ? showServices : undefined,
      showIncidents: hasField('showIncidents') ? showIncidents : undefined,
      showMetrics: hasField('showMetrics') ? showMetrics : undefined,
      showSubscribe: hasField('showSubscribe') ? showSubscribe : undefined,
      uptimeExcellentThreshold: uptimeExcellentThreshold ?? undefined,
      uptimeGoodThreshold: uptimeGoodThreshold ?? undefined,
      footerText: hasField('footerText') ? nullableText(footerText) : undefined,
      contactEmail: hasField('contactEmail') ? nullableText(contactEmail) : undefined,
      contactUrl: hasField('contactUrl') ? nullableText(contactUrl) : undefined,
    };

    if (name !== undefined && name !== null && name.trim().length > 0) {
      try {
        updateData.name = await assertStatusPageNameAvailable(name, { excludeId: statusPage.id });
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
      if (branding === null) {
        updateData.branding = Prisma.JsonNull;
      } else {
        const existingBranding =
          statusPage.branding &&
          typeof statusPage.branding === 'object' &&
          !Array.isArray(statusPage.branding)
            ? (statusPage.branding as Record<string, unknown>)
            : {};
        updateData.branding = {
          ...existingBranding,
          ...(branding as Record<string, unknown>),
        } as Prisma.InputJsonValue;
      }
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
    if (showIncidentHistoryDetails !== undefined)
      updateData.showIncidentHistoryDetails = showIncidentHistoryDetails;
    if (incidentHistoryDetailDays !== undefined)
      updateData.incidentHistoryDetailDays = incidentHistoryDetailDays;
    if (showChangelog !== undefined) updateData.showChangelog = showChangelog;
    if (showRegionHeatmap !== undefined) updateData.showRegionHeatmap = showRegionHeatmap;
    if (showPostIncidentReview !== undefined)
      updateData.showPostIncidentReview = showPostIncidentReview;
    if (maxIncidentsToShow !== undefined) updateData.maxIncidentsToShow = maxIncidentsToShow;
    if (incidentHistoryDays !== undefined) updateData.incidentHistoryDays = incidentHistoryDays;
    if (allowedCustomFields !== undefined)
      updateData.allowedCustomFields =
        allowedCustomFields === null
          ? Prisma.JsonNull
          : (allowedCustomFields as Prisma.InputJsonValue);
    if (dataRetentionDays !== undefined) updateData.dataRetentionDays = dataRetentionDays;
    if (requireAuth !== undefined) updateData.requireAuth = requireAuth;
    if (authProvider !== undefined)
      updateData.authProvider = authProvider && authProvider.trim() ? authProvider.trim() : null;
    if (emailProvider !== undefined)
      updateData.emailProvider =
        emailProvider && emailProvider.trim() ? emailProvider.trim() : null;
    if (enableUptimeExports !== undefined) updateData.enableUptimeExports = enableUptimeExports;
    if (statusApiRequireToken !== undefined)
      updateData.statusApiRequireToken = statusApiRequireToken;
    if (statusApiRateLimitEnabled !== undefined)
      updateData.statusApiRateLimitEnabled = statusApiRateLimitEnabled;
    if (statusApiRateLimitMax !== undefined)
      updateData.statusApiRateLimitMax = statusApiRateLimitMax;
    if (statusApiRateLimitWindowSec !== undefined)
      updateData.statusApiRateLimitWindowSec = statusApiRateLimitWindowSec;

    // No revoke here. Whether the current projection must be withdrawn is a property of the
    // change, and the publication command decides it from the diff. Unconditionally revoking is
    // what previously took the public page dark on every save, including a colour change.
    const result = await applyStatusPageConfigurationChange({
      pageId: statusPage.id,
      actor,
      patch: updateData as Record<string, unknown>,
      serviceIds,
      serviceConfigs,
      expectedUpdatedAt,
      section: req.headers.get(STATUS_PAGE_SECTION_HEADER) ?? undefined,
      // Logo externalization must commit atomically with the settings row that references it.
      transform: async (tx, patch) =>
        patch.branding && typeof patch.branding === 'object'
          ? {
              ...patch,
              branding: await externalizeStatusPageLogo(
                tx,
                statusPage.id,
                patch.branding as Record<string, unknown>
              ),
            }
          : patch,
    });

    // revalidatePath is deliberately absent: this route is force-dynamic with revalidate = 0, so
    // there is no cache entry to invalidate. Public reads propagate through the serving store,
    // and subdomain/custom-domain lookups through the middleware's own domain cache.
    logger.info('api.status_page.updated', {
      statusPageId: statusPage.id,
      changeClass: result.classification.dominant,
      publication: result.publication.status,
    });
    return jsonOk(
      { success: true, updatedAt: result.updatedAt, publication: result.publication },
      200
    );
  } catch (error) {
    if (error instanceof StatusPageAdminError) return jsonError(error.message, 404);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return jsonError(new AppError({ code: 'STATUS_PAGE_STALE', cause: error }));
    }
    const prismaError = prismaToAppError(error, { unique: statusPageUniqueError });
    if (prismaError) return jsonError(prismaError);
    if (isAppError(error)) return jsonError(error);
    logger.error('api.status_page.update_error', { error });
    return jsonError('Failed to update status page', 500);
  }
}
