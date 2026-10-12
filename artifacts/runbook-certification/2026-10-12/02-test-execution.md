# OpsKnight Runbooks Certification — 02. Chronological Test Execution Log

**Execution Timestamp:** 2026-10-12  
**Commit:** `ea38c8c5601189225e3c5edd1efeed855c034c7d`  
**Host:** macOS 26.6.2 (Darwin arm64)  

---

## 1. Phase 0 — Host Tooling & Git Tree Verification

### 1.1 Git Working Tree & Commit
```bash
$ git checkout main && git pull origin main
Already on 'main'
Your branch is up to date with 'origin/main'.

$ git log -1 --oneline
ea38c8c56 feat(runbooks): safe authoring, execution preview and release QA (#859)

$ git status -s
(clean)
```

### 1.2 Binary & Toolchain Availability
```bash
$ docker --version
Docker version 29.7.2, build 83149e9

$ kubectl version --client
Client Version: v1.32.2
Kustomize Version: v5.5.0

$ kind version
kind v0.27.0 go1.24.0 darwin/arm64

$ node -v && npm -v
v20.18.0
10.8.2
```

---

## 2. Release & Change Gate Execution

### 2.1 CI Change Gates Classification
```bash
$ node --test tests/ci/runbook-change-gates.test.cjs
✔ classifies runbook-only changes correctly (1.2ms)
✔ classifies deployment changes correctly (0.8ms)
✔ classifies swarm-only changes correctly (0.7ms)
✔ handles shared changes across boundaries (0.9ms)
✔ defaults safely when unrecognized paths change (0.8ms)
✔ validates exact workflow triggers (0.8ms)
ℹ tests 6
ℹ suites 0
ℹ pass 6
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 44.521875
```
**Exit Code:** 0 (PASSED)

### 2.2 Documentation & Capability Parity Linting
```bash
$ npm run docs:lint
> opsknight@2.0.0 docs:lint
> npm run docs:frontmatter && npm run docs:links && npm run docs:capabilities && npm run docs:evidence
✔ 322 docs files validated
✔ Frontmatter schema conformant
✔ Capability matrix and link targets resolved
```
**Exit Code:** 0 (PASSED)

### 2.3 Strict TypeScript Compilation
```bash
$ npx tsc --noEmit --incremental false
```
**Exit Code:** 0 (PASSED, 0 type errors across whole codebase)

---

## 3. Automated Vitest Suites Execution

### 3.1 Runbook Authoring & Protocol Release Gates
```bash
$ npx vitest run --no-file-parallelism --maxWorkers=1 \
    tests/lib/runbooks \
    tests/lib/client-navigation-guard.test.ts \
    tests/components/RunbookBuilder.test.tsx \
    tests/components/RunbookExecutionPreview.test.tsx \
    tests/integration/runbook-agent-runtime.test.ts \
    tests/lib/deployment-config-unit.test.ts
```
**Result:** 28 test files passed (334 / 334 tests passed)  
**Duration:** 33.15s  
**Exit Code:** 0 (PASSED)

### 3.2 RBAC Authorization & Page Guards
```bash
$ npx vitest run \
    tests/lib/rbac.test.ts \
    tests/lib/rbac-read-guards.test.ts \
    tests/architecture/rbac-page-guards.test.ts
```
**Result:** 3 test files passed (66 / 66 tests passed)  
**Duration:** 1.87s  
**Exit Code:** 0 (PASSED)

### 3.3 Runbook API, Metrics & Encryption Registry
```bash
$ npx vitest run --no-file-parallelism --maxWorkers=1 \
    tests/api/runbook-artifacts.test.ts \
    tests/api/metrics.test.ts \
    tests/lib/operational-metric-registry.test.ts \
    tests/unit/encryption-registry.test.ts \
    tests/lib/encryption-keyring-rotation.test.ts
```
**Result:** 5 test files passed (25 / 25 tests passed)  
**Duration:** 4.44s  
**Exit Code:** 0 (PASSED)

---

## 4. Real PostgreSQL Database Integration Testing

### 4.1 Database Initialization & Migration Deployment
```bash
$ docker exec compose-opsknight-db-1 psql -U opsknight -d postgres -c "CREATE DATABASE runbook_test;"
CREATE DATABASE

$ DATABASE_URL="postgresql://opsknight:opsknight_secure_password_change_me@localhost:5432/runbook_test" npx prisma migrate deploy
392 migrations applied successfully.
Latest migration: 20261011130000_runbook_preview_authorization
```
**Exit Code:** 0 (PASSED)

### 4.2 Real Database Safety, Preview Authorization & Lifecycle
```bash
$ VITEST_USE_REAL_DB=1 \
  DATABASE_URL="postgresql://opsknight:opsknight_secure_password_change_me@localhost:5432/runbook_test" \
  DIRECT_URL="postgresql://opsknight:opsknight_secure_password_change_me@localhost:5432/runbook_test" \
  ENCRYPTION_KEY="68112f544b2c8b0f84436ea34293f733c33e49b41e657b9db0275f5edf09c7ba" \
  npx vitest run --no-file-parallelism --maxWorkers=1 \
  tests/integration/runbook-execution-safety.test.ts \
  tests/integration/runbook-preview-authorization.test.ts \
  tests/integration/runbook-lifecycle-database.test.ts
```
**Summary of Test Suites:**
- `tests/integration/runbook-execution-safety.test.ts`: 57 / 57 passed
  - Concurrent step completion fences verified
  - Replay and retry safety for non-idempotent steps verified
  - Agent attempt lease renewal, fencing, and heartbeat tracking verified
- `tests/integration/runbook-preview-authorization.test.ts`: 34 / 34 passed
  - Preview digest immutability verified
  - Incident context drift rejection (title, priority, urgency, tags, service) verified
  - Single atomic consumption of preview tokens verified
- `tests/integration/runbook-lifecycle-database.test.ts`: 17 / 17 passed
  - Version transitions (DRAFT -> PUBLISHED -> RETIRED) verified
  - Published immutability invariants enforced
**Total Passed:** 3 test files, 108 tests  
**Duration:** 135.45s  
**Exit Code:** 0 (PASSED)

### 4.3 Database Encryption Migration & CAS Concurrency
```bash
$ VITEST_USE_REAL_DB=1 \
  DATABASE_URL="postgresql://opsknight:opsknight_secure_password_change_me@localhost:5432/runbook_test" \
  DIRECT_URL="postgresql://opsknight:opsknight_secure_password_change_me@localhost:5432/runbook_test" \
  ENCRYPTION_KEY="68112f544b2c8b0f84436ea34293f733c33e49b41e657b9db0275f5edf09c7ba" \
  npx vitest run tests/integration/encryption-migration.test.ts
```
**Result:** 1 test file passed (7 / 7 tests passed)  
- CAS concurrency protection verified
- Key retirement readiness evaluation verified
- Keyring rotation and duplicate key deduplication verified  
**Duration:** 11.93s  
**Exit Code:** 0 (PASSED)

---

## 5. Kubernetes Live Workload Certification (Kind)

### 5.1 Kind Cluster Creation
```bash
$ kind create cluster --name opsknight-runbook-cert --wait 180s
Creating cluster "opsknight-runbook-cert" ...
 • Ensuring node image (kindest/node:v1.37.0) 🖼️  ...
 ✓ Ensuring node image (kindest/node:v1.37.0) 🖼️
 • Preparing nodes 📦   ...
 ✓ Preparing nodes 📦 
 • Writing configuration 📜  ...
 ✓ Writing configuration 📜
 • Starting control-plane 🕹️  ...
 ✓ Starting control-plane 🕹️
 • Installing CNI 🔌  ...
 ✓ Installing CNI 🔌
 • Installing StorageClass 💾  ...
 ✓ Installing StorageClass 💾
 • Waiting ≤ 3m0s for control-plane = Ready ⏳  ...
 ✓ Waiting ≤ 3m0s for control-plane = Ready ⏳
 • Ready after 16s 💚
```
**Exit Code:** 0 (PASSED)

### 5.2 Test Namespace & Workload Provisioning
```bash
$ kubectl --context kind-opsknight-runbook-cert create namespace opsknight-cert
namespace/opsknight-cert created

$ kubectl --context kind-opsknight-runbook-cert -n opsknight-cert create deployment cert-web --image=nginx:stable-alpine
deployment.apps/cert-web created

$ kubectl --context kind-opsknight-runbook-cert -n opsknight-cert rollout status deployment/cert-web --timeout=180s
Waiting for deployment "cert-web" rollout to finish: 0 of 1 updated replicas are available...
deployment "cert-web" successfully rolled out
```
**Workload Status:**
- Pod `cert-web-79bfc48d88-lcd7j`: `1/1 Running`, 0 restarts
- Deployment `cert-web`: `1/1 Available`, Ready
**Exit Code:** 0 (PASSED)

---

## 6. Remote Control Plane Connectivity Diagnostics

```bash
$ nslookup opcenterio.com
** server can't find opcenterio.com: NXDOMAIN

$ curl -Iv https://opcenterio.com
curl: (6) Could not resolve host: opcenterio.com

$ whois opcenterio.com
No match for domain "OPCENTERIO.COM".
```
**Result:** Classified as **`BLOCKED_BY_ENVIRONMENT`** per certification rule 7.
