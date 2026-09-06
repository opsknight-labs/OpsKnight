-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN', 'RESPONDER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "AuditEntityType" AS ENUM ('USER', 'TEAM', 'TEAM_MEMBER', 'SERVICE', 'ESCALATION_POLICY');

-- CreateEnum
CREATE TYPE "ServiceStatus" AS ENUM ('OPERATIONAL', 'DEGRADED', 'PARTIAL_OUTAGE', 'MAJOR_OUTAGE', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SNOOZED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'PUSH', 'SLACK', 'WEBHOOK', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "InAppNotificationType" AS ENUM ('INCIDENT', 'SCHEDULE', 'TEAM', 'SERVICE');

-- CreateEnum
CREATE TYPE "DigestLevel" AS ENUM ('HIGH', 'ALL', 'NONE');

-- CreateEnum
CREATE TYPE "IncidentUrgency" AS ENUM ('LOW', 'HIGH');

-- CreateEnum
CREATE TYPE "EscalationTargetType" AS ENUM ('USER', 'TEAM', 'SCHEDULE');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('ESCALATION', 'NOTIFICATION', 'AUTO_UNSNOOZE', 'SCHEDULED_TASK');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'SELECT', 'BOOLEAN', 'URL', 'EMAIL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "passwordHash" TEXT,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "dailySummary" BOOLEAN NOT NULL DEFAULT true,
    "incidentDigest" "DigestLevel" NOT NULL DEFAULT 'HIGH',
    "emailNotificationsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "smsNotificationsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pushNotificationsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "whatsappNotificationsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "phoneNumber" TEXT,
    "invitedAt" TIMESTAMP(3),
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "teamLeadId" TEXT,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'MEMBER',
    "receiveTeamNotifications" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "region" TEXT,
    "slaTier" TEXT,
    "status" "ServiceStatus" NOT NULL DEFAULT 'OPERATIONAL',
    "targetAckMinutes" INTEGER NOT NULL DEFAULT 15,
    "targetResolveMinutes" INTEGER NOT NULL DEFAULT 120,
    "teamId" TEXT,
    "escalationPolicyId" TEXT,
    "slackWebhookUrl" TEXT,
    "slackChannel" TEXT,
    "slackWorkspaceId" TEXT,
    "slackIntegrationId" TEXT,
    "webhookUrl" TEXT,
    "serviceNotificationChannels" "NotificationChannel"[] DEFAULT ARRAY[]::"NotificationChannel"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalationPolicy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EscalationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalationRule" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "delayMinutes" INTEGER NOT NULL DEFAULT 0,
    "stepOrder" INTEGER NOT NULL,
    "targetType" "EscalationTargetType" NOT NULL DEFAULT 'USER',
    "targetUserId" TEXT,
    "targetTeamId" TEXT,
    "targetScheduleId" TEXT,
    "notificationChannels" "NotificationChannel"[],
    "notifyOnlyTeamLead" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "EscalationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'EVENTS_API_V2',
    "key" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookIntegration" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT,
    "channel" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlackOAuthConfig" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "redirectUri" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "SlackOAuthConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OidcConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "issuer" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "autoProvision" BOOLEAN NOT NULL DEFAULT true,
    "allowedDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "OidcConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlackIntegration" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "workspaceName" TEXT,
    "botToken" TEXT NOT NULL,
    "signingSecret" TEXT,
    "installedBy" TEXT NOT NULL,
    "scopes" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlackIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "dedupKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'TRIGGERED',
    "payload" JSONB NOT NULL,
    "serviceId" TEXT NOT NULL,
    "incidentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "urgency" "IncidentUrgency" NOT NULL DEFAULT 'HIGH',
    "priority" TEXT,
    "dedupKey" TEXT,
    "serviceId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "teamId" TEXT,
    "currentEscalationStep" INTEGER,
    "nextEscalationAt" TIMESTAMP(3),
    "escalationStatus" TEXT,
    "escalationProcessingAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),
    "snoozeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentTag" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "title" TEXT NOT NULL,
    "descriptionText" TEXT,
    "defaultUrgency" "IncidentUrgency" NOT NULL DEFAULT 'HIGH',
    "defaultPriority" TEXT,
    "defaultServiceId" TEXT,
    "createdById" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "teamId" TEXT,

    CONSTRAINT "IncidentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentWatcher" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'FOLLOWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentWatcher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentEvent" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentNote" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Postmortem" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "timeline" JSONB,
    "impact" JSONB,
    "rootCause" TEXT,
    "resolution" TEXT,
    "actionItems" JSONB,
    "lessons" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Postmortem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnCallSchedule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnCallSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnCallLayer" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3),
    "rotationLengthHours" INTEGER NOT NULL DEFAULT 24,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnCallLayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnCallLayerUser" (
    "id" TEXT NOT NULL,
    "layerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OnCallLayerUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnCallOverride" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "replacesUserId" TEXT,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnCallOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnCallShift" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnCallShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorMsg" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InAppNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "InAppNotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InAppNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "userAgent" TEXT,
    "lastUsed" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" "AuditEntityType" NOT NULL,
    "entityId" TEXT,
    "actorId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationProvider" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackgroundJob" (
    "id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "error" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusPage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Status Page',
    "organizationName" TEXT,
    "subdomain" TEXT,
    "customDomain" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "showServices" BOOLEAN NOT NULL DEFAULT true,
    "showIncidents" BOOLEAN NOT NULL DEFAULT true,
    "showMetrics" BOOLEAN NOT NULL DEFAULT true,
    "showSubscribe" BOOLEAN NOT NULL DEFAULT true,
    "branding" JSONB,
    "footerText" TEXT,
    "contactEmail" TEXT,
    "contactUrl" TEXT,
    "privacyMode" TEXT DEFAULT 'PUBLIC',
    "showIncidentDetails" BOOLEAN NOT NULL DEFAULT true,
    "showIncidentTitles" BOOLEAN NOT NULL DEFAULT true,
    "showIncidentDescriptions" BOOLEAN NOT NULL DEFAULT true,
    "showAffectedServices" BOOLEAN NOT NULL DEFAULT true,
    "showIncidentTimestamps" BOOLEAN NOT NULL DEFAULT true,
    "showServiceMetrics" BOOLEAN NOT NULL DEFAULT true,
    "showServiceDescriptions" BOOLEAN NOT NULL DEFAULT true,
    "showServiceRegions" BOOLEAN NOT NULL DEFAULT true,
    "showServicesByRegion" BOOLEAN NOT NULL DEFAULT false,
    "showServiceOwners" BOOLEAN NOT NULL DEFAULT false,
    "showServiceSlaTier" BOOLEAN NOT NULL DEFAULT false,
    "showTeamInformation" BOOLEAN NOT NULL DEFAULT false,
    "showCustomFields" BOOLEAN NOT NULL DEFAULT false,
    "showIncidentAssignees" BOOLEAN NOT NULL DEFAULT false,
    "showIncidentUrgency" BOOLEAN NOT NULL DEFAULT true,
    "showUptimeHistory" BOOLEAN NOT NULL DEFAULT true,
    "showRecentIncidents" BOOLEAN NOT NULL DEFAULT true,
    "showChangelog" BOOLEAN NOT NULL DEFAULT true,
    "showRegionHeatmap" BOOLEAN NOT NULL DEFAULT true,
    "showPostIncidentReview" BOOLEAN NOT NULL DEFAULT true,
    "maxIncidentsToShow" INTEGER NOT NULL DEFAULT 50,
    "incidentHistoryDays" INTEGER NOT NULL DEFAULT 90,
    "allowedCustomFields" JSONB,
    "dataRetentionDays" INTEGER,
    "requireAuth" BOOLEAN NOT NULL DEFAULT false,
    "authProvider" TEXT,
    "emailProvider" TEXT,
    "enableUptimeExports" BOOLEAN NOT NULL DEFAULT false,
    "statusApiRequireToken" BOOLEAN NOT NULL DEFAULT false,
    "statusApiRateLimitEnabled" BOOLEAN NOT NULL DEFAULT false,
    "statusApiRateLimitMax" INTEGER NOT NULL DEFAULT 120,
    "statusApiRateLimitWindowSec" INTEGER NOT NULL DEFAULT 60,
    "uptimeExcellentThreshold" DOUBLE PRECISION NOT NULL DEFAULT 99.9,
    "uptimeGoodThreshold" DOUBLE PRECISION NOT NULL DEFAULT 99.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StatusPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusPageService" (
    "id" TEXT NOT NULL,
    "statusPageId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "displayName" TEXT,
    "showOnPage" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatusPageService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusPageAnnouncement" (
    "id" TEXT NOT NULL,
    "statusPageId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'INFO',
    "incidentId" TEXT,
    "affectedServiceIds" JSONB,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StatusPageAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusPageApiToken" (
    "id" TEXT NOT NULL,
    "statusPageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "StatusPageApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusPageSubscription" (
    "id" TEXT NOT NULL,
    "statusPageId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "token" TEXT NOT NULL,
    "subscribedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unsubscribedAt" TIMESTAMP(3),
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verificationToken" TEXT,
    "preferences" JSONB,

    CONSTRAINT "StatusPageSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusPageWebhook" (
    "id" TEXT NOT NULL,
    "statusPageId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastTriggeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StatusPageWebhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomField" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" "CustomFieldType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "defaultValue" TEXT,
    "options" JSONB,
    "order" INTEGER NOT NULL DEFAULT 0,
    "showInList" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFieldValue" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "customFieldId" TEXT NOT NULL,
    "value" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchPreset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdById" TEXT NOT NULL,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "filterCriteria" JSONB NOT NULL,
    "icon" TEXT,
    "color" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "sharedWithTeams" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchPreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchPresetUsage" (
    "id" TEXT NOT NULL,
    "presetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchPresetUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "appUrl" TEXT,
    "encryptionKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_status_idx" ON "User"("role", "status");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_userId_teamId_key" ON "TeamMember"("userId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "Service_slackIntegrationId_key" ON "Service"("slackIntegrationId");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_key_key" ON "Integration"("key");

-- CreateIndex
CREATE INDEX "WebhookIntegration_serviceId_idx" ON "WebhookIntegration"("serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "SlackOAuthConfig_id_key" ON "SlackOAuthConfig"("id");

-- CreateIndex
CREATE UNIQUE INDEX "OidcConfig_id_key" ON "OidcConfig"("id");

-- CreateIndex
CREATE INDEX "SlackIntegration_workspaceId_idx" ON "SlackIntegration"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "SlackIntegration_workspaceId_key" ON "SlackIntegration"("workspaceId");

-- CreateIndex
CREATE INDEX "Alert_serviceId_status_idx" ON "Alert"("serviceId", "status");

-- CreateIndex
CREATE INDEX "Alert_incidentId_idx" ON "Alert"("incidentId");

-- CreateIndex
CREATE INDEX "Alert_dedupKey_status_idx" ON "Alert"("dedupKey", "status");

-- CreateIndex
CREATE INDEX "Alert_createdAt_idx" ON "Alert"("createdAt");

-- CreateIndex
CREATE INDEX "Incident_dedupKey_idx" ON "Incident"("dedupKey");

-- CreateIndex
CREATE INDEX "Incident_serviceId_dedupKey_status_idx" ON "Incident"("serviceId", "dedupKey", "status");

-- CreateIndex
CREATE INDEX "Incident_nextEscalationAt_escalationStatus_idx" ON "Incident"("nextEscalationAt", "escalationStatus");

-- CreateIndex
CREATE INDEX "Incident_escalationProcessingAt_idx" ON "Incident"("escalationProcessingAt");

-- CreateIndex
CREATE INDEX "Incident_snoozedUntil_idx" ON "Incident"("snoozedUntil");

-- CreateIndex
CREATE INDEX "Incident_status_createdAt_idx" ON "Incident"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Incident_serviceId_status_idx" ON "Incident"("serviceId", "status");

-- CreateIndex
CREATE INDEX "Incident_assigneeId_status_idx" ON "Incident"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "Incident_teamId_status_idx" ON "Incident"("teamId", "status");

-- CreateIndex
CREATE INDEX "Incident_createdAt_idx" ON "Incident"("createdAt");

-- CreateIndex
CREATE INDEX "Incident_urgency_status_idx" ON "Incident"("urgency", "status");

-- CreateIndex
CREATE INDEX "Incident_status_urgency_createdAt_idx" ON "Incident"("status", "urgency", "createdAt");

-- CreateIndex
CREATE INDEX "Incident_status_assigneeId_idx" ON "Incident"("status", "assigneeId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "IncidentTag_incidentId_idx" ON "IncidentTag"("incidentId");

-- CreateIndex
CREATE INDEX "IncidentTag_tagId_idx" ON "IncidentTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentTag_incidentId_tagId_key" ON "IncidentTag"("incidentId", "tagId");

-- CreateIndex
CREATE INDEX "IncidentTemplate_createdById_idx" ON "IncidentTemplate"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentWatcher_incidentId_userId_key" ON "IncidentWatcher"("incidentId", "userId");

-- CreateIndex
CREATE INDEX "IncidentEvent_incidentId_createdAt_idx" ON "IncidentEvent"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "IncidentNote_incidentId_createdAt_idx" ON "IncidentNote"("incidentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Postmortem_incidentId_key" ON "Postmortem"("incidentId");

-- CreateIndex
CREATE INDEX "Postmortem_incidentId_idx" ON "Postmortem"("incidentId");

-- CreateIndex
CREATE INDEX "Postmortem_status_createdAt_idx" ON "Postmortem"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Postmortem_createdById_idx" ON "Postmortem"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "OnCallLayerUser_layerId_userId_key" ON "OnCallLayerUser"("layerId", "userId");

-- CreateIndex
CREATE INDEX "OnCallShift_start_end_idx" ON "OnCallShift"("start", "end");

-- CreateIndex
CREATE INDEX "OnCallShift_userId_start_end_idx" ON "OnCallShift"("userId", "start", "end");

-- CreateIndex
CREATE INDEX "Notification_incidentId_idx" ON "Notification"("incidentId");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE INDEX "Notification_status_createdAt_idx" ON "Notification"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_channel_status_idx" ON "Notification"("channel", "status");

-- CreateIndex
CREATE INDEX "InAppNotification_userId_createdAt_idx" ON "InAppNotification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "InAppNotification_userId_readAt_idx" ON "InAppNotification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "InAppNotification_userId_readAt_createdAt_idx" ON "InAppNotification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "UserDevice_userId_idx" ON "UserDevice"("userId");

-- CreateIndex
CREATE INDEX "UserDevice_token_idx" ON "UserDevice"("token");

-- CreateIndex
CREATE UNIQUE INDEX "UserDevice_userId_deviceId_key" ON "UserDevice"("userId", "deviceId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "ApiKey_userId_idx" ON "ApiKey"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationProvider_provider_key" ON "NotificationProvider"("provider");

-- CreateIndex
CREATE INDEX "NotificationProvider_provider_idx" ON "NotificationProvider"("provider");

-- CreateIndex
CREATE INDEX "BackgroundJob_type_status_scheduledAt_idx" ON "BackgroundJob"("type", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "BackgroundJob_status_scheduledAt_idx" ON "BackgroundJob"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "BackgroundJob_scheduledAt_idx" ON "BackgroundJob"("scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "StatusPage_subdomain_key" ON "StatusPage"("subdomain");

-- CreateIndex
CREATE UNIQUE INDEX "StatusPage_customDomain_key" ON "StatusPage"("customDomain");

-- CreateIndex
CREATE INDEX "StatusPage_enabled_idx" ON "StatusPage"("enabled");

-- CreateIndex
CREATE INDEX "StatusPageService_statusPageId_order_idx" ON "StatusPageService"("statusPageId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "StatusPageService_statusPageId_serviceId_key" ON "StatusPageService"("statusPageId", "serviceId");

-- CreateIndex
CREATE INDEX "StatusPageAnnouncement_statusPageId_isActive_startDate_idx" ON "StatusPageAnnouncement"("statusPageId", "isActive", "startDate");

-- CreateIndex
CREATE INDEX "StatusPageAnnouncement_incidentId_idx" ON "StatusPageAnnouncement"("incidentId");

-- CreateIndex
CREATE INDEX "StatusPageApiToken_statusPageId_revokedAt_idx" ON "StatusPageApiToken"("statusPageId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StatusPageApiToken_tokenHash_key" ON "StatusPageApiToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "StatusPageSubscription_token_key" ON "StatusPageSubscription"("token");

-- CreateIndex
CREATE INDEX "StatusPageSubscription_statusPageId_verified_idx" ON "StatusPageSubscription"("statusPageId", "verified");

-- CreateIndex
CREATE INDEX "StatusPageSubscription_token_idx" ON "StatusPageSubscription"("token");

-- CreateIndex
CREATE UNIQUE INDEX "StatusPageSubscription_statusPageId_email_key" ON "StatusPageSubscription"("statusPageId", "email");

-- CreateIndex
CREATE INDEX "StatusPageWebhook_statusPageId_enabled_idx" ON "StatusPageWebhook"("statusPageId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "CustomField_key_key" ON "CustomField"("key");

-- CreateIndex
CREATE INDEX "CustomField_key_idx" ON "CustomField"("key");

-- CreateIndex
CREATE INDEX "CustomField_order_idx" ON "CustomField"("order");

-- CreateIndex
CREATE INDEX "CustomFieldValue_incidentId_idx" ON "CustomFieldValue"("incidentId");

-- CreateIndex
CREATE INDEX "CustomFieldValue_customFieldId_idx" ON "CustomFieldValue"("customFieldId");

-- CreateIndex
CREATE INDEX "CustomFieldValue_value_idx" ON "CustomFieldValue"("value");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldValue_incidentId_customFieldId_key" ON "CustomFieldValue"("incidentId", "customFieldId");

-- CreateIndex
CREATE INDEX "SearchPreset_createdById_idx" ON "SearchPreset"("createdById");

-- CreateIndex
CREATE INDEX "SearchPreset_isShared_isPublic_idx" ON "SearchPreset"("isShared", "isPublic");

-- CreateIndex
CREATE INDEX "SearchPreset_order_idx" ON "SearchPreset"("order");

-- CreateIndex
CREATE INDEX "SearchPreset_lastUsedAt_idx" ON "SearchPreset"("lastUsedAt");

-- CreateIndex
CREATE INDEX "SearchPresetUsage_presetId_idx" ON "SearchPresetUsage"("presetId");

-- CreateIndex
CREATE INDEX "SearchPresetUsage_userId_idx" ON "SearchPresetUsage"("userId");

-- CreateIndex
CREATE INDEX "SearchPresetUsage_usedAt_idx" ON "SearchPresetUsage"("usedAt");

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_teamLeadId_fkey" FOREIGN KEY ("teamLeadId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_escalationPolicyId_fkey" FOREIGN KEY ("escalationPolicyId") REFERENCES "EscalationPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_slackIntegrationId_fkey" FOREIGN KEY ("slackIntegrationId") REFERENCES "SlackIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationRule" ADD CONSTRAINT "EscalationRule_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "EscalationPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationRule" ADD CONSTRAINT "EscalationRule_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationRule" ADD CONSTRAINT "EscalationRule_targetTeamId_fkey" FOREIGN KEY ("targetTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationRule" ADD CONSTRAINT "EscalationRule_targetScheduleId_fkey" FOREIGN KEY ("targetScheduleId") REFERENCES "OnCallSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookIntegration" ADD CONSTRAINT "WebhookIntegration_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlackOAuthConfig" ADD CONSTRAINT "SlackOAuthConfig_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OidcConfig" ADD CONSTRAINT "OidcConfig_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlackIntegration" ADD CONSTRAINT "SlackIntegration_installedBy_fkey" FOREIGN KEY ("installedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentTag" ADD CONSTRAINT "IncidentTag_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentTag" ADD CONSTRAINT "IncidentTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentTemplate" ADD CONSTRAINT "IncidentTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentTemplate" ADD CONSTRAINT "IncidentTemplate_defaultServiceId_fkey" FOREIGN KEY ("defaultServiceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentTemplate" ADD CONSTRAINT "IncidentTemplate_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentWatcher" ADD CONSTRAINT "IncidentWatcher_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentWatcher" ADD CONSTRAINT "IncidentWatcher_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentEvent" ADD CONSTRAINT "IncidentEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentNote" ADD CONSTRAINT "IncidentNote_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentNote" ADD CONSTRAINT "IncidentNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Postmortem" ADD CONSTRAINT "Postmortem_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Postmortem" ADD CONSTRAINT "Postmortem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnCallLayer" ADD CONSTRAINT "OnCallLayer_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "OnCallSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnCallLayerUser" ADD CONSTRAINT "OnCallLayerUser_layerId_fkey" FOREIGN KEY ("layerId") REFERENCES "OnCallLayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnCallLayerUser" ADD CONSTRAINT "OnCallLayerUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnCallOverride" ADD CONSTRAINT "OnCallOverride_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "OnCallSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnCallOverride" ADD CONSTRAINT "OnCallOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnCallOverride" ADD CONSTRAINT "OnCallOverride_replacesUserId_fkey" FOREIGN KEY ("replacesUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnCallShift" ADD CONSTRAINT "OnCallShift_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "OnCallSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnCallShift" ADD CONSTRAINT "OnCallShift_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InAppNotification" ADD CONSTRAINT "InAppNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDevice" ADD CONSTRAINT "UserDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationProvider" ADD CONSTRAINT "NotificationProvider_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusPageService" ADD CONSTRAINT "StatusPageService_statusPageId_fkey" FOREIGN KEY ("statusPageId") REFERENCES "StatusPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusPageService" ADD CONSTRAINT "StatusPageService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusPageAnnouncement" ADD CONSTRAINT "StatusPageAnnouncement_statusPageId_fkey" FOREIGN KEY ("statusPageId") REFERENCES "StatusPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusPageAnnouncement" ADD CONSTRAINT "StatusPageAnnouncement_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusPageApiToken" ADD CONSTRAINT "StatusPageApiToken_statusPageId_fkey" FOREIGN KEY ("statusPageId") REFERENCES "StatusPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusPageSubscription" ADD CONSTRAINT "StatusPageSubscription_statusPageId_fkey" FOREIGN KEY ("statusPageId") REFERENCES "StatusPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusPageWebhook" ADD CONSTRAINT "StatusPageWebhook_statusPageId_fkey" FOREIGN KEY ("statusPageId") REFERENCES "StatusPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_customFieldId_fkey" FOREIGN KEY ("customFieldId") REFERENCES "CustomField"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchPreset" ADD CONSTRAINT "SearchPreset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchPresetUsage" ADD CONSTRAINT "SearchPresetUsage_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "SearchPreset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchPresetUsage" ADD CONSTRAINT "SearchPresetUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
