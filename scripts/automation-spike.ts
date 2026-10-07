import { PrismaClient } from '@prisma/client';
import { compileAutomation } from '../src/lib/automation/compiler';
import { evaluateAutomation } from '../src/lib/automation/evaluator';
import { extractContext } from '../src/lib/automation/context/extract';
const prisma = new PrismaClient();
async function main() {
  const results = [];
  for (const count of [-1, 0, 25, 50, 100]) {
    const version = compileAutomation({ schemaVersion: 1, fields: [{ fieldId: 'env', key: 'environment', label: 'Environment', type: 'ENUM', allowedValues: ['production'], mappings: [{ source: 'PROVIDER', path: '$.environment' }] }], rules: Array.from({ length: Math.max(0, count) }, (_, i) => ({ id: `r${i}`, name: `Rule ${i}`, phase: 'ENRICH', conditions: [{ fieldKey: 'environment', operator: 'EQ', value: 'production' }], actions: [{ type: 'SET_PRIORITY', value: 'P1' }] })) }).compiled;
    const transactions: number[] = [], evaluations: number[] = [];
    for (let i = 0; i < 120; i++) {
      const start = performance.now();
      await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('automation-spike', 0))`;
        await tx.$queryRaw`SELECT 1`;
        const evalStart = performance.now();
        if (count >= 0) {
          const context = extractContext({ fields: version.fields, providerPayload: { environment: 'production' }, normalizedEvent: {}, integrationType: 'WEBHOOK' });
          if (count > 0) evaluateAutomation({ version, initialContext: context, evaluationAt: '2026-10-07T00:00:00Z' });
        }
        evaluations.push(performance.now() - evalStart);
      });
      if (i >= 20) transactions.push(performance.now() - start);
    }
    const percentile = (values: number[], percentile: number) => [...values].sort((a,b) => a-b)[Math.min(values.length - 1, Math.floor(values.length * percentile))];
    results.push({ rules: count, transactionP50: percentile(transactions, .5), transactionP95: percentile(transactions, .95), evaluatorP50: percentile(evaluations, .5), evaluatorP99: percentile(evaluations, .99) });
  }
  process.stdout.write(JSON.stringify({ kind: 'PostgreSQL transaction boundary spike; full ingest certification follows', results }, null, 2) + '\n');
}
main().finally(() => prisma.$disconnect());
