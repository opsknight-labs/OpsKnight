import 'server-only';
import type { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '@/lib/db/create-client';
import { configurePrismaDatasource, selectPrismaDatasourceUrl } from '@/lib/prisma-datasource';
import { getOpsKnightProcessRole } from '@/lib/runtime-role';

let maintenanceClient: PrismaClient | null = null;
export function getMaintenanceClient() {
  // Maintenance cannot consume the scheduler/recovery connection pool.
  return (maintenanceClient ??= createPrismaClient({
    url: configurePrismaDatasource(
      selectPrismaDatasourceUrl(getOpsKnightProcessRole()),
      '1',
      getOpsKnightProcessRole() === 'web' && process.env.PGBOUNCER_ENABLED === 'true'
    ),
    applicationName: `opsknight-${getOpsKnightProcessRole()}-maintenance`,
  }));
}

export async function disconnectMaintenanceClient() {
  await maintenanceClient?.$disconnect();
  maintenanceClient = null;
}
