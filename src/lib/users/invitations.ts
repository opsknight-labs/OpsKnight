import 'server-only';
import type { Prisma } from '@prisma/client';
import { z } from 'zod/v3';
import { AppError } from '@/lib/errors';
import { runSerializableTransaction } from '@/lib/db-utils';
import { approveInvitedUserForSso } from '@/lib/auth-control/sso-onboarding';
import { authenticationOrigin } from '@/lib/auth-control/origin';
import { formatInviteUrl, mintUserInviteCapability } from '@/lib/invitations';
import { getAppUrl } from '@/lib/app-url';
import { logAudit } from '@/lib/audit';
import { createCentralNotificationIntent } from '@/lib/notification-control-plane';
import { getAllConfiguredEmailProviders } from '@/lib/notification-providers';
import { getUserInviteEmailTemplate } from '@/lib/user-invite-email-template';
import { preconditionFailed } from '@/lib/api-v2/concurrency';
import type { UserAdministrationActor } from './administration';
import {
  invitationCreateInput,
  invitationRenewInput,
  linkingApprovalRevision,
  linkingApprovalSelect,
  readInvitationPolicy,
  type InvitationDeliveryPolicy,
} from './invitation-policy';

export type InvitationDisclosure = 'DISCLOSED_ONCE' | 'ALREADY_DISCLOSED' | 'NOT_REQUESTED';
export type InvitationPreparation = { emailProviders: string[]; appUrl: string };
const invitationUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  revision: true,
  invitationGeneration: true,
} satisfies Prisma.UserSelect;
type CommandOptions = {
  prepared?: InvitationPreparation;
  client?: Prisma.TransactionClient;
  expectedRevision?: number;
  /** UI may display the capability alongside queued mail. Public EMAIL responses never disclose it. */
  allowManualDisclosure?: boolean;
  beforeWrite?: (tx: Prisma.TransactionClient) => Promise<void>;
};
export async function prepareInvitationDelivery() {
  const configured = await getAllConfiguredEmailProviders();
  return [
    ...new Set(configured.flatMap(item => (item.enabled && item.provider ? [item.provider] : []))),
  ];
}
/** Resolve global configuration before reserving a connection for a mutation transaction. */
export async function prepareUserInvitation(): Promise<InvitationPreparation> {
  const [emailProviders, appUrl] = await Promise.all([prepareInvitationDelivery(), getAppUrl()]);
  return { emailProviders, appUrl };
}
export async function issueUserInvitation(
  input: z.input<typeof invitationCreateInput>,
  actor: UserAdministrationActor,
  options: CommandOptions = {}
) {
  const values = invitationCreateInput.parse(input);
  return executeInvitation({ kind: 'create', values }, actor, options);
}
export async function renewUserInvitation(
  userId: string,
  input: z.input<typeof invitationRenewInput>,
  actor: UserAdministrationActor,
  options: CommandOptions = {}
) {
  z.string().cuid().parse(userId);
  const values = invitationRenewInput.parse(input);
  return executeInvitation({ kind: 'renew', userId, values }, actor, options);
}
type InvitationCommand =
  | { kind: 'create'; values: z.output<typeof invitationCreateInput> }
  | { kind: 'renew'; userId: string; values: z.output<typeof invitationRenewInput> };
async function executeInvitation(
  command: InvitationCommand,
  actor: UserAdministrationActor,
  options: CommandOptions
) {
  if (options.client && !options.prepared)
    throw new Error('Prepare invitation configuration before opening the mutation transaction.');
  const prepared = options.prepared ?? (await prepareUserInvitation());
  const providers = command.values.delivery === 'EMAIL' ? prepared.emailProviders : [];
  if (command.values.delivery === 'EMAIL' && !providers.length)
    throw new AppError({
      code: 'NOTIFICATION_PROVIDER_UNAVAILABLE',
      userMessage: 'Configure an email provider or explicitly request manual invitation delivery.',
    });
  const operation = async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(210012002::bigint)`;
    await tx.$queryRaw`SELECT "id" FROM "AuthenticationPolicy" WHERE "id" = 'default' FOR UPDATE`;
    await options.beforeWrite?.(tx);
    const policy = await readInvitationPolicy(tx, actor);
    if (
      policy.policyVersion !== command.values.expectedPolicyVersion ||
      policy.oidcConfigVersion !== command.values.expectedOidcConfigVersion
    )
      throw preconditionFailed();
    if (command.values.authenticationMode === 'PASSWORD' && !policy.passwordInvitationsAllowed)
      throw new AppError({
        code: 'AUTHORIZATION_DENIED',
        userMessage: 'Password invitations are disabled by authentication policy.',
      });
    if (command.values.authenticationMode === 'SSO' && !policy.ssoInvitationsAllowed)
      throw new AppError({
        code: 'RESOURCE_CONFLICT',
        userMessage: 'Activate the reviewed SSO connection before issuing an SSO invitation.',
      });
    if (command.values.delivery === 'EMAIL') {
      // Literal predicate matches the partial index even when PostgreSQL uses a generic plan.
      // We need only prove saturation, never scan/count the entire invitation history.
      const pending = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Notification"
        WHERE "sourceType" = 'USER_INVITATION'
          AND status IN ('PENDING'::"NotificationStatus", 'FAILED'::"NotificationStatus", 'UNKNOWN'::"NotificationStatus")
          AND ("expiresAt" IS NULL OR "expiresAt" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))
        LIMIT 64`;
      if (pending.length >= 64)
        throw new AppError({
          code: 'RATE_LIMIT_EXCEEDED',
          userMessage:
            'Invitation delivery is at capacity. Resolve pending deliveries before retrying.',
          details: { retryAfter: 30 },
        });
    }
    let user;
    if (command.kind === 'create') {
      const existing = await tx.user.findUnique({
        where: { email: command.values.email },
        select: { id: true },
      });
      if (existing)
        throw new AppError({
          code: 'RESOURCE_CONFLICT',
          userMessage: 'A user with that email already exists.',
        });
      user = await tx.user.create({
        data: {
          name: command.values.name,
          email: command.values.email,
          role: command.values.role,
          roleSource: 'MANUAL',
          status: 'INVITED',
          invitedAt: new Date(),
          invitationGeneration: 1,
        },
        select: invitationUserSelect,
      });
    } else {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${command.userId} FOR UPDATE`;
      const existing = await tx.user.findUnique({
        where: { id: command.userId },
        select: invitationUserSelect,
      });
      if (!existing)
        throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'User not found.' });
      if (options.expectedRevision !== undefined && existing.revision !== options.expectedRevision)
        throw preconditionFailed();
      if (existing.status !== 'INVITED')
        throw new AppError({
          code: 'RESOURCE_CONFLICT',
          userMessage:
            'Only pending invitations can be renewed. Active users must use recovery; disabled users must be reactivated first.',
        });
      const approval = await tx.oidcLinkingApproval.findUnique({
        where: { userId: existing.id },
        select: linkingApprovalSelect,
      });
      if (linkingApprovalRevision(approval) !== command.values.expectedLinkingApprovalRevision)
        throw preconditionFailed();
      user = await tx.user.update({
        where: { id: existing.id },
        data: { invitedAt: new Date(), invitationGeneration: { increment: 1 } },
        select: invitationUserSelect,
      });
    }
    let inviteUrl: string,
      expiresAt = new Date(Date.now() + 7 * 86400000);
    let approvalGeneration: number | undefined;
    if (command.values.authenticationMode === 'SSO') {
      const origin = await authenticationOrigin(tx);
      const approval = await approveInvitedUserForSso(tx, user.id, actor);
      approvalGeneration = approval.generation;
      if (!approval.expiresAt) throw new Error('SSO invitation expiry was not persisted.');
      expiresAt = approval.expiresAt;
      inviteUrl = `${origin}/login`;
    } else {
      const capability = await mintUserInviteCapability(
        tx,
        user.id,
        user.email,
        user.invitationGeneration
      );
      expiresAt = capability.expiresAt;
      await tx.oidcLinkingApproval.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date(), generation: { increment: 1 } },
      });
      inviteUrl = formatInviteUrl(capability.token, prepared.appUrl);
      await logAudit(
        {
          action: command.kind === 'create' ? 'user.invited' : 'user.invite.resent',
          entityType: 'USER',
          entityId: user.id,
          actorId: actor.id,
          source: actor.apiKey ? 'API' : 'UI',
          details: {
            email: user.email,
            role: user.role,
            invitationGeneration: user.invitationGeneration,
            delivery: command.values.delivery,
            ...(actor.apiKey ? { apiClientId: actor.apiKey.id } : {}),
          },
          targetEmail: user.email,
        },
        tx
      );
    }
    let notificationId: string | null = null;
    if (command.values.delivery === 'EMAIL') {
      const principal = await tx.user.findUniqueOrThrow({
        where: { id: actor.id },
        select: { name: true },
      });
      const template = getUserInviteEmailTemplate({
        userName: user.name,
        invitedBy: principal.name || undefined,
        inviteUrl,
        ssoOnly: command.values.authenticationMode === 'SSO',
      });
      const invitationPolicy: InvitationDeliveryPolicy = {
        userId: user.id,
        email: user.email,
        invitationGeneration: user.invitationGeneration,
        authenticationMode: command.values.authenticationMode,
        ...(approvalGeneration ? { approvalGeneration } : {}),
      };
      const intent = await createCentralNotificationIntent(
        {
          category: 'ADMINISTRATION',
          channel: 'EMAIL',
          recipientType: 'USER',
          recipientId: user.id,
          recipientAddress: user.email,
          userId: user.id,
          templateKey: 'user-invitation',
          sourceType: 'USER_INVITATION',
          sourceId: user.id,
          eventKey: `${user.invitationGeneration}:${command.values.authenticationMode}:${approvalGeneration ?? 0}`,
          displayMessage: 'Workspace invitation',
          expiresAt,
          payload: {
            kind: 'EMAIL',
            to: user.email,
            subject: template.subject,
            html: template.html,
            text: template.text,
            providerKey: providers[0],
            emailRoute: providers,
            invitationPolicy,
          },
        },
        tx
      );
      if (intent.skipped)
        throw new AppError({
          code: 'RESOURCE_CONFLICT',
          userMessage:
            'Invitation email is blocked by recipient delivery policy. Review the endpoint before retrying.',
        });
      notificationId = intent.id;
    }
    const disclose = command.values.delivery === 'MANUAL' || options.allowManualDisclosure === true;
    return {
      userId: user.id,
      revision: user.revision,
      status: 'INVITED' as const,
      authenticationMode: command.values.authenticationMode,
      invitationGeneration: user.invitationGeneration,
      expiresAt,
      notificationId,
      deliveryStatus: notificationId ? ('QUEUED' as const) : ('MANUAL' as const),
      inviteUrl: disclose ? inviteUrl : null,
      recipientEmail: user.email,
      disclosure: (disclose ? 'DISCLOSED_ONCE' : 'NOT_REQUESTED') as InvitationDisclosure,
    };
  };
  return options.client ? operation(options.client) : runSerializableTransaction(operation);
}
