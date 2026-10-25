import fs from 'node:fs';
import path from 'node:path';
import { V2_OPERATIONS } from '../../src/lib/api-v2/openapi-registry';
import { V2_MUTATION_CONTRACT } from '../../src/lib/api-v2/mutation-contract';
import { API_CAPABILITY_CATALOG } from '../../src/lib/api-v2/capability-catalog';
import { getOpenApiV2Spec } from '../../src/lib/api-v2/openapi';
import { API_SCOPE_REGISTRY } from '../../src/lib/api-scope-registry';

console.log('=== PHASE 0 DISCOVERY VERIFICATION ===\n');

// 1. Total & Uniqueness of operationIds
const opIds = new Set<string>();
const duplicateOpIds = new Set<string>();
for (const op of V2_OPERATIONS) {
  if (opIds.has(op.operationId)) {
    duplicateOpIds.add(op.operationId);
  }
  opIds.add(op.operationId);
}
console.log(`[1] Total V2_OPERATIONS: ${V2_OPERATIONS.length}`);
console.log(`    Unique operation IDs: ${opIds.size}`);
if (duplicateOpIds.size > 0) {
  console.error(`    FAIL: Duplicate operation IDs: ${Array.from(duplicateOpIds).join(', ')}`);
} else {
  console.log('    PASS: Zero duplicate operation IDs.');
}

// 2. Check every registered operation maps to a real handler file exporting that HTTP method
let missingHandlers = 0;
for (const op of V2_OPERATIONS) {
  const relPath = op.path.replace(/\{([^}]+)\}/g, '[$1]');
  const routeFile = path.join('src/app/api/v2', relPath, 'route.ts');
  if (!fs.existsSync(routeFile)) {
    console.error(`    FAIL: Missing route file for ${op.operationId}: ${routeFile}`);
    missingHandlers++;
  } else {
    const src = fs.readFileSync(routeFile, 'utf8');
    const upperMethod = op.method.toUpperCase();
    const methodRegex = new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${upperMethod}\\b`);
    if (!methodRegex.test(src)) {
      console.error(`    FAIL: ${routeFile} does not export ${upperMethod} for ${op.operationId}`);
      missingHandlers++;
    }
  }
}
if (missingHandlers === 0) {
  console.log(`[2] PASS: All ${V2_OPERATIONS.length} operations map to existing handler files exporting their HTTP method.`);
} else {
  console.error(`[2] FAIL: ${missingHandlers} operations missing handler or method!`);
}

// 3. Check every route.ts in src/app/api/v2 is cataloged
function scanRoutes(dir: string, base: string = ''): string[] {
  let list: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      list.push(...scanRoutes(path.join(dir, entry.name), path.join(base, entry.name)));
    } else if (entry.name === 'route.ts') {
      list.push(base);
    }
  }
  return list;
}
const allV2Routes = scanRoutes('src/app/api/v2');
console.log(`[3] Total route.ts files in src/app/api/v2: ${allV2Routes.length}`);

let uncatalogedRoutes = 0;
for (const r of allV2Routes) {
  const routeFile = path.join('src/app/api/v2', r, 'route.ts');
  const src = fs.readFileSync(routeFile, 'utf8');
  const apiPath = '/' + r.replace(/\[([^\]]+)\]/g, '{$1}').replace(/\\/g, '/');
  for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    const methodRegex = new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${m}\\b`);
    if (methodRegex.test(src)) {
      const match = V2_OPERATIONS.find(op => op.path === apiPath && op.method.toUpperCase() === m);
      if (!match) {
        console.error(`    FAIL: Uncataloged route handler: ${m} ${apiPath} in ${routeFile}`);
        uncatalogedRoutes++;
      }
    }
  }
}
if (uncatalogedRoutes === 0) {
  console.log(`    PASS: Zero uncataloged HTTP route handlers found in src/app/api/v2.`);
} else {
  console.error(`    FAIL: ${uncatalogedRoutes} uncataloged route handlers!`);
}

// 4. OpenAPI Spec verification
const spec = getOpenApiV2Spec() as any;
let missingSpec = 0;
for (const op of V2_OPERATIONS) {
  const p = spec.paths[op.path];
  if (!p) {
    console.error(`    FAIL: Missing path in OpenAPI: ${op.path}`);
    missingSpec++;
  } else if (!p[op.method.toLowerCase()]) {
    console.error(`    FAIL: Missing method in OpenAPI: ${op.method} ${op.path}`);
    missingSpec++;
  }
}
if (missingSpec === 0) {
  console.log(`[4] PASS: All ${V2_OPERATIONS.length} operations exist in deployed OpenAPI spec.`);
} else {
  console.error(`[4] FAIL: ${missingSpec} operations missing from OpenAPI spec!`);
}

// 5. Scopes verification
let invalidScopes = 0;
for (const op of V2_OPERATIONS) {
  if (!(API_SCOPE_REGISTRY as Record<string, any>)[op.scope]) {
    console.error(`    FAIL: Invalid scope ${op.scope} for ${op.operationId}`);
    invalidScopes++;
  }
}
if (invalidScopes === 0) {
  console.log(`[5] PASS: All ${V2_OPERATIONS.length} operation scopes are registered in API_SCOPE_REGISTRY.`);
} else {
  console.error(`[5] FAIL: ${invalidScopes} operations with invalid scope!`);
}

// 6. Mutation contract verification
const mutatingOps = V2_OPERATIONS.filter(op => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(op.method.toUpperCase()));
let missingMutationContract = 0;
for (const op of mutatingOps) {
  const relPath = op.path.replace(/\{([^}]+)\}/g, '[$1]');
  const key = `${op.method.toUpperCase()} /api/v2${relPath}`;
  if (!V2_MUTATION_CONTRACT[key]) {
    console.warn(`    WARNING: Mutation missing from V2_MUTATION_CONTRACT: ${key}`);
    missingMutationContract++;
  }
}
console.log(`[6] Mutation contract: ${mutatingOps.length - missingMutationContract}/${mutatingOps.length} mutating ops registered in V2_MUTATION_CONTRACT.`);

// 7. Capability catalog verification
console.log(`[7] Capabilities in API_CAPABILITY_CATALOG: ${API_CAPABILITY_CATALOG.length}`);
const catalogOpIds = new Set<string>();
for (const cap of API_CAPABILITY_CATALOG) {
  for (const id of cap.operationIds) {
    catalogOpIds.add(id);
  }
}
console.log(`    Total unique operations in capability catalog: ${catalogOpIds.size}`);
const unassignedOps = V2_OPERATIONS.filter(op => !catalogOpIds.has(op.operationId));
if (unassignedOps.length > 0) {
  console.warn(`    WARNING: ${unassignedOps.length} operations not mapped to any capability catalog entry.`);
} else {
  console.log('    PASS: All operations mapped in capability catalog.');
}

console.log('\n=== PHASE 0 DISCOVERY COMPLETE ===');
