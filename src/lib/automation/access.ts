import { assertCanViewService, assertCanModifyService, getUserPermissions } from '@/lib/rbac';
import { AuthorizationError } from '@/lib/authorization';
export async function assertAutomationAccess(
  serviceId: string,
  capability: 'automation.read' | 'automation.edit' | 'automation.publish'
) {
  const user =
    capability === 'automation.edit'
      ? await assertCanModifyService(serviceId)
      : await assertCanViewService(serviceId);
  const permissions = await getUserPermissions();
  if (!permissions.capabilities.includes(capability))
    throw new AuthorizationError('Automation access denied', capability);
  return user;
}
