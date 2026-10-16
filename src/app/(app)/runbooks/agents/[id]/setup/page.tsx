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
import { RunbookPageHeader } from '@/components/runbooks/RunbookPageHeader';
import { EmptyHint } from '@/components/runbooks/ui/primitives';
import { Button } from '@/components/ui/shadcn/button';
import { ArrowLeft, ArrowUpCircle, ShieldX } from 'lucide-react';
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
  const breadcrumbs = [
    { label: 'Runbooks', href: '/runbooks' },
    { label: 'Execution Infrastructure', href: '/runbooks/agents' },
    { label: agent.name },
  ];
  if (agent.status === 'REVOKED')
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
        <RunbookPageHeader title={`Upgrade ${agent.name}`} breadcrumbs={breadcrumbs} />
        <EmptyHint
          icon={ShieldX}
          title="This identity is revoked. Create a new enrollment to replace it."
          description="Revoked Agents cannot be upgraded in place. Enroll a new Agent with a new deployment name and volume."
          className="bg-card"
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/runbooks/agents">Return to Agents</Link>
            </Button>
          }
        />
      </div>
    );
  const [appUrl, distribution, key] = await Promise.all([
    getAppUrl(),
    getAgentDistribution(),
    getExecutionSigningKey(),
  ]);
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
      <RunbookPageHeader
        title={`Upgrade ${agent.name}`}
        icon={ArrowUpCircle}
        breadcrumbs={breadcrumbs}
        description="Use the deployment name saved during installation. Agents installed with older instructions may use the original name opsknight-agent. Confirm the existing project, stack, release or Deployment before applying an upgrade. Preserve its identity volume and local policy."
      />
      <AgentSetupInstructions
        agentId={agent.id}
        token=""
        executionPublicKey={key.publicKey}
        appUrl={appUrl}
        distribution={distribution}
        initialOperation="upgrade"
        expiresAt="2000-01-01T00:00:00Z"
      />
      <Button asChild variant="ghost" size="sm" className="gap-1.5">
        <Link href="/runbooks/agents">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Return to Agent health and diagnostics
        </Link>
      </Button>
    </div>
  );
}
