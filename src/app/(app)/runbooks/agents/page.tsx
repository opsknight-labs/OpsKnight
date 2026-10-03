import Link from 'next/link';
import { ArrowLeft, Bot, ShieldOff } from 'lucide-react';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability, getUserPermissions } from '@/lib/rbac';
import AgentEnrollmentForm from '@/components/runbooks/AgentEnrollmentForm';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { revokeAgentAction } from '../actions';

export const revalidate = 0;

export default async function RunbookAgentsPage() {
  await assertCapability(CAPABILITIES.RUNBOOK_READ_ALL);
  const [permissions, agents] = await Promise.all([
    getUserPermissions(),
    prisma.runbookAgent.findMany({
      include: {
        poolMemberships: { include: { pool: true } },
        _count: { select: { claimedAttempts: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  const canManage = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_AGENT_MANAGE);
  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-6 p-4 sm:p-6 lg:p-8">
      <Link
        href="/runbooks"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Runbooks
      </Link>
      <header>
        <h1 className="font-heading text-3xl font-semibold">Agents</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Outbound-only execution identities. Enrollment tokens are single-use and requests are
          signed with the agent&apos;s private key.
        </p>
      </header>
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Add agent</CardTitle>
            <CardDescription>
              The token expires after 15 minutes. The permanent private key is generated on the
              agent and never leaves it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AgentEnrollmentForm />
          </CardContent>
        </Card>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {agents.map(agent => (
          <Card key={agent.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Bot className="h-4 w-4" /> {agent.name}
                  </CardTitle>
                  <CardDescription>
                    {agent.hostname || 'Hostname pending enrollment'}
                  </CardDescription>
                </div>
                <Badge
                  variant={
                    agent.status === 'ONLINE'
                      ? 'default'
                      : agent.status === 'REVOKED'
                        ? 'destructive'
                        : 'secondary'
                  }
                >
                  {agent.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-xs text-muted-foreground">
              <div>
                Version {agent.version || '—'} · Platform {agent.platform || '—'}
              </div>
              <div>
                Last heartbeat {agent.lastHeartbeatAt?.toLocaleString() || 'Never'} ·{' '}
                {agent._count.claimedAttempts} attempts
              </div>
              <div>
                {agent.poolMemberships.map(item => item.pool.name).join(', ') || 'No agent pool'}
              </div>
              {canManage && agent.status !== 'REVOKED' && (
                <form action={revokeAgentAction.bind(null, agent.id)}>
                  <Button type="submit" size="sm" variant="destructive">
                    <ShieldOff /> Revoke
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
