import prisma from '../../src/lib/prisma';

async function main() {
  const services = await prisma.service.findMany({
    select: { id: true, name: true, status: true },
    take: 10,
  });

  const runbooks = await prisma.runbook.findMany({
    where: { archivedAt: null },
    select: { id: true, name: true, publishedVersionId: true },
    take: 10,
  });

  const rules = await prisma.serviceAutomationRule.findMany({
    where: { detachedAt: null },
    select: {
      id: true,
      serviceId: true,
      runbookId: true,
      mode: true,
      enabled: true,
      versionStrategy: true,
      defaultAgentId: true,
      defaultAgentPoolId: true,
      runbook: { select: { name: true } },
      service: { select: { name: true } },
    },
    take: 10,
  });

  const agents = await prisma.runbookAgent.findMany({
    where: { status: { not: 'REVOKED' } },
    select: { id: true, name: true, status: true, capabilities: true, lastHeartbeatAt: true },
    take: 10,
  });

  console.log('=== SERVICES ===');
  console.log(JSON.stringify(services, null, 2));

  console.log('=== RUNBOOKS ===');
  console.log(JSON.stringify(runbooks, null, 2));

  console.log('=== RULES ===');
  console.log(JSON.stringify(rules, null, 2));

  console.log('=== AGENTS ===');
  console.log(JSON.stringify(agents, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
