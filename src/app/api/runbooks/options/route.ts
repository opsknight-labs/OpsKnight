import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';

const schema = z.object({ kind: z.enum(['service', 'runbook', 'agent', 'target']), q: z.string().trim().max(100).default(''), selected: z.string().max(160).optional() }).strict();
export async function GET(request: NextRequest) {
  await assertCapability(CAPABILITIES.RUNBOOK_READ_ALL);
  const parsed = schema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid search' }, { status: 400 });
  const { kind, q, selected } = parsed.data;
  const name = { contains: q, mode: 'insensitive' as const };
  const select = { id: true, name: true };
  const orderBy = [{ name: 'asc' as const }, { id: 'asc' as const }];
  if (kind === 'target') {
    await assertCapability(CAPABILITIES.RUNBOOK_SECRET_MANAGE);
    const [agents, pools] = await Promise.all([
      prisma.runbookAgent.findMany({ where: { status: { not: 'REVOKED' }, name }, select, take: 20, orderBy }),
      prisma.runbookAgentPool.findMany({ where: { name }, select, take: 20, orderBy }),
    ]);
    return NextResponse.json({ options: [...pools.map(item => ({ value: `pool:${item.id}`, label: `Pool · ${item.name}` })), ...agents.map(item => ({ value: `agent:${item.id}`, label: `Agent · ${item.name}` }))] });
  }
  const where = { OR: [{ name }, ...(selected ? [{ id: selected }] : [])] };
  const rows = kind === 'service' ? await prisma.service.findMany({ where, select, take: 30, orderBy }) : kind === 'runbook' ? await prisma.runbook.findMany({ where, select, take: 30, orderBy }) : await prisma.runbookAgent.findMany({ where: { ...where, status: { not: 'REVOKED' } }, select, take: 30, orderBy });
  // Resolve the selected label even when it lies outside the search page.
  const selectedRow = selected && !rows.some(row => row.id === selected)
    ? kind === 'service' ? await prisma.service.findUnique({ where: { id: selected }, select }) : kind === 'runbook' ? await prisma.runbook.findUnique({ where: { id: selected }, select }) : await prisma.runbookAgent.findFirst({ where: { id: selected, status: { not: 'REVOKED' } }, select })
    : null;
  return NextResponse.json({ options: [...(selectedRow ? [selectedRow] : []), ...rows].map(item => ({ value: item.id, label: item.name })) });
}
