import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { assertCapability } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import { getAppUrl } from '@/lib/app-url';
import { getAgentDistribution } from '@/lib/runbooks/distribution';
import { getExecutionSigningKey } from '@/lib/runbooks/execution-signing';
import AgentSetupInstructions from '@/components/runbooks/AgentSetupInstructions';
export const dynamic = 'force-dynamic';
export default async function AgentLifecyclePage({ params }: { params: Promise<{ id: string }> }) {
  await assertCapability(CAPABILITIES.RUNBOOK_AGENT_MANAGE);
  const id = z
    .string()
    .cuid()
    .parse((await params).id);
  const agent = await prisma.runbookAgent.findUnique({
    where: { id },
    select: { id: true, name: true, status: true },
  });
  if (!agent) notFound();
  if (agent.status === 'REVOKED')
    return (
      <p>
        This identity is revoked. Create a new enrollment to replace it.{' '}
        <Link href="/runbooks/agents">Return to Agents</Link>
      </p>
    );
  const [appUrl, distribution, key] = await Promise.all([
    getAppUrl(),
    getAgentDistribution(),
    getExecutionSigningKey(),
  ]);
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <h1 className="text-xl font-semibold">Upgrade {agent.name}</h1>
      <p>
        Use the deployment name saved during installation. Agents installed with older instructions
        may use the original name opsknight-agent. Confirm the existing project, stack, release or
        Deployment before applying an upgrade. Preserve its identity volume and local policy.
      </p>
      <AgentSetupInstructions
        agentId={agent.id}
        token=""
        executionPublicKey={key.publicKey}
        appUrl={appUrl}
        distribution={distribution}
        initialOperation="upgrade"
        expiresAt="2000-01-01T00:00:00Z"
      />
      <Link href="/runbooks/agents" className="underline">
        Return to Agent health and diagnostics
      </Link>
    </div>
  );
}
