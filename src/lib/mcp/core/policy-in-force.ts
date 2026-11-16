import 'server-only';
import prisma from '@/lib/prisma';
import { mcpPolicyInForce } from './kill-switch';

/**
 * Whether people can connect assistants right now: the stored switch and the deployment's. Used
 * only to decide whether to point people at MCP, so a failed read means "no" instead of an error.
 */
export async function loadMcpInForce() {
  try {
    return mcpPolicyInForce(
      await prisma.mcpPolicy.findUnique({ where: { id: 'default' }, select: { enabled: true } })
    );
  } catch {
    return false;
  }
}
