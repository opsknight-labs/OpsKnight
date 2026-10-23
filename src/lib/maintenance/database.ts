import 'server-only';
import { PrismaClient } from '@prisma/client';
import { configurePrismaDatasource, selectPrismaDatasourceUrl } from '@/lib/prisma-datasource';
import { getOpsKnightProcessRole } from '@/lib/runtime-role';

let maintenanceClient: PrismaClient | null = null;
export function getMaintenanceClient() {
  // Maintenance cannot consume the scheduler/recovery connection pool.
  return (maintenanceClient ??= new PrismaClient({
    datasourceUrl: configurePrismaDatasource(
      selectPrismaDatasourceUrl(getOpsKnightProcessRole()),
      '1'
    ),
  }));
}

export async function disconnectMaintenanceClient() {
  await maintenanceClient?.$disconnect();
  maintenanceClient = null;
}
