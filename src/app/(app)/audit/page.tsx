import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { getUserTimeZone, formatDateTime } from '@/lib/timezone';
import { DirectUserAvatar } from '@/components/UserAvatar';
import { getDefaultAvatar } from '@/lib/avatar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/shadcn/table';
import { Card } from '@/components/ui/shadcn/card';

export const dynamic = 'force-dynamic';

export default async function AuditLogPage() {
  const session = await getServerSession(await getAuthOptions());
  const email = session?.user?.email ?? null;
  const user = email
    ? await prisma.user.findUnique({ where: { email }, select: { timeZone: true } })
    : null;
  const userTimeZone = getUserTimeZone(user ?? undefined);

  const logs = await prisma.auditLog.findMany({
    include: {
      actor: {
        select: {
          id: true,
          name: true,
          email: true,
          avatarUrl: true,
          gender: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 250,
  });

  return (
    <main className="p-4 [zoom:0.8]">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Audit Log</h1>
          <p className="text-muted-foreground">User, team, and service configuration changes.</p>
        </div>
      </div>

      {/* Audit Table */}
      <Card className="bg-white overflow-hidden">
        <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
          <Table className="min-w-[800px]">
            <TableHeader className="bg-slate-50 border-b border-border">
              <TableRow>
                <TableHead className="text-left p-4 font-semibold text-muted-foreground">
                  Timestamp
                </TableHead>
                <TableHead className="text-left p-4 font-semibold text-muted-foreground">
                  Actor
                </TableHead>
                <TableHead className="text-left p-4 font-semibold text-muted-foreground">
                  Action
                </TableHead>
                <TableHead className="text-left p-4 font-semibold text-muted-foreground">
                  Entity
                </TableHead>
                <TableHead className="text-left p-4 font-semibold text-muted-foreground">
                  Details
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map(log => (
                <TableRow key={log.id} className="border-b border-slate-100">
                  <TableCell className="p-4 font-mono text-xs text-muted-foreground">
                    {formatDateTime(log.createdAt, userTimeZone, { format: 'datetime' })}
                  </TableCell>
                  <TableCell className="p-4">
                    <div className="flex items-center gap-3">
                      {log.actor ? (
                        <DirectUserAvatar
                          avatarUrl={
                            log.actor.avatarUrl ||
                            getDefaultAvatar(
                              log.actor.gender,
                              log.actor.id || log.actor.name || 'user'
                            )
                          }
                          name={log.actor.name}
                          size="sm"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-[0.7rem] font-semibold text-gray-500">
                          SYS
                        </div>
                      )}
                      <div>
                        <div className="font-semibold">{log.actor?.name || 'System'}</div>
                        <div className="text-xs text-muted-foreground">
                          {log.actor?.email || '-'}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="p-4 font-semibold">{log.action}</TableCell>
                  <TableCell className="p-4">
                    <div className="text-sm">{log.entityType}</div>
                    <div className="text-xs text-muted-foreground">{log.entityId || '-'}</div>
                  </TableCell>
                  <TableCell className="p-4 text-sm text-muted-foreground">
                    {log.details ? JSON.stringify(log.details) : '-'}
                  </TableCell>
                </TableRow>
              ))}
              {logs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="p-8 text-center text-muted-foreground">
                    No audit entries yet. Actions on users, teams, and services will appear here.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </main>
  );
}
