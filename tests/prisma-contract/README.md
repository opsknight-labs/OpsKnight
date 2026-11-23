# Prisma runtime contract suite

Version-agnostic evidence that OpsKnight's database behaviour is unchanged across Prisma
upgrades (5.22 → 6.x → 7.x) and driver changes (Rust engine → `@prisma/adapter-pg`).

The suite records **application-visible** behaviour, not Prisma internals:

- JavaScript types and values returned by raw SQL and model queries
- raw-SQL parameter typing
- the outputs of OpsKnight's own error classifiers (retry, HTTP mapping, escalation)
- transaction, locking, time-zone, `Bytes`, session-setting, TLS and PgBouncer behaviour

## Running

```bash
eval "$(tests/prisma-contract/infra/up.sh)"     # isolated Postgres/TLS/TZ/PgBouncer stack
npx prisma migrate deploy                        # with DATABASE_URL=$CONTRACT_DATABASE_URL (and TZ URL)
npm run test:prisma-contract                     # verify against committed goldens
PRISMA_CONTRACT_MODE=record npm run test:prisma-contract   # re-record (baseline only!)
tests/prisma-contract/infra/down.sh
```

Goldens in `__golden__/` were recorded on Prisma 5.22.0 (`origin/main` @ `bbf64b9e5`).
They must **never** be re-recorded to make an upgrade pass. Deliberate behaviour changes are
declared, with a reason, in `support/intentional-changes.ts`, and are applied to the golden
side during verification.

## Baseline findings on Prisma 5.22 (recorded, not changed by the baseline)

These were reproduced on macOS and in `node:22-alpine` (the production base OS) with a valid
private CA (verified by OpenSSL 3 and Node TLS):

1. **TLS verification is never performed for `sslmode=verify-full` / `verify-ca`.** Prisma 5
   treats every `sslmode` other than `disable`/`require` (including unknown values) as
   `prefer`: an untrusted CA, a missing root certificate and a wrong host name all connect.
   Against a server that allows plaintext, `verify-full` connects **without encryption**
   (`plain.verifyFull`).
2. `sslaccept=strict` rejects even a correctly signed server certificate, so strict
   verification was unusable.
3. Through PgBouncer the `options` startup parameter is dropped, so the
   `statement_timeout=30000` / `jit=off` defaults written by `configurePrismaDatasource` are
   **not applied** to pooled (web/http) roles (`pgbouncer.configured`).
4. On a server whose default `TimeZone` is not UTC, raw SQL that compares a `Date` parameter
   with a `timestamp without time zone` column misses rows, and raw writes to such columns
   shift by the server offset (`timezone.json` → `asiaKolkata`). Model queries are correct.
5. A batch `$transaction([...], { isolationLevel })` containing only raw queries runs at the
   default isolation level (`isolation.batchSerializable`).
