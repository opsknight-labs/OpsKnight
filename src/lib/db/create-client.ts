import net from 'node:net';
import { PrismaClient, type Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  DriverAdapterError,
  type ConnectionInfo,
  type SqlDriverAdapter,
  type SqlMigrationAwareDriverAdapterFactory,
  type SqlQuery,
  type SqlQueryable,
} from '@prisma/driver-adapter-utils';
import pg from 'pg';
import { toPrismaClientError } from './errors';
import { planPgConnection, type PgConnectionPlan } from './pg-config';
import { rawSqlTextFromCall, registerRawSql } from './raw-parameter-types';
import { instrumentAdapter } from './sql-audit';

const ADAPTER_NAME = '@prisma/adapter-pg';
const POOL_TIMEOUT_MESSAGE = 'timeout exceeded when trying to connect';

function emit(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown>) {
  const line = JSON.stringify({ level, event, ...fields, timestamp: new Date().toISOString() });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}

/**
 * node-postgres reports an exhausted pool with an untyped Error. Tag it as a socket timeout so
 * the Prisma adapter classifies it (P1008 / SocketTimeout) instead of an unknown error,
 * matching Prisma 5's "timed out fetching a connection" handling.
 */
function tagPoolTimeout(error: unknown): unknown {
  if (error instanceof Error && error.message === POOL_TIMEOUT_MESSAGE && !('code' in error)) {
    Object.assign(error, { code: 'ETIMEDOUT', syscall: 'connect', errno: -60 });
  }
  return error;
}

type PoolCallback = (
  err: Error | undefined,
  client?: pg.PoolClient,
  done?: (release?: unknown) => void
) => void;

/**
 * Prisma 5 always used PostgreSQL's extended query protocol, which accepts exactly one statement.
 * node-postgres switches to the simple protocol for parameterless queries, which would let a
 * `$executeRawUnsafe('A; B')` run stacked statements. Keep the single-statement guarantee.
 */
function forceExtendedProtocol(client: pg.PoolClient) {
  const query = client.query.bind(client) as (...args: unknown[]) => unknown;
  client.query = ((config: unknown, ...rest: unknown[]) => {
    if (
      typeof config === 'object' &&
      config !== null &&
      typeof (config as { text?: unknown }).text === 'string' &&
      typeof (config as { submit?: unknown }).submit !== 'function' &&
      (config as { queryMode?: unknown }).queryMode === undefined
    ) {
      return query({ ...(config as object), queryMode: 'extended' }, ...rest);
    }
    return query(config, ...rest);
  }) as typeof client.query;
}

export class OpsKnightPgPool extends pg.Pool {
  constructor(config?: pg.PoolConfig) {
    super(config);
    this.on('connect', client => forceExtendedProtocol(client));
  }

  // pg.Pool#connect is overloaded (callback and promise forms); both must be tagged.
  connect(): Promise<pg.PoolClient>;
  connect(callback: PoolCallback): void;
  connect(callback?: PoolCallback): Promise<pg.PoolClient> | void {
    if (callback) {
      return super.connect((err, client, done) =>
        callback(err ? (tagPoolTimeout(err) as Error) : err, client, done)
      );
    }
    return super.connect().catch(error => {
      throw tagPoolTimeout(error);
    });
  }
}

/** libpq's first negotiation step: does the server accept TLS on this endpoint? */
export function probeServerTls(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(
      () =>
        socket.destroy(
          Object.assign(new Error('TLS probe timed out'), {
            code: 'ETIMEDOUT',
            syscall: 'connect',
            errno: -60,
          })
        ),
      timeoutMs || 10_000
    );
    socket.once('connect', () => {
      const request = Buffer.alloc(8);
      request.writeInt32BE(8, 0);
      request.writeInt32BE(80877103, 4);
      socket.write(request);
    });
    socket.once('data', data => {
      clearTimeout(timer);
      socket.destroy();
      resolve(data[0] === 0x53); // 'S'
    });
    socket.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once('close', () => clearTimeout(timer));
  });
}

function toDriverAdapterError(error: unknown, host: string, port: number): unknown {
  const code = (error as { code?: unknown })?.code;
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH') {
    return new DriverAdapterError({ kind: 'DatabaseNotReachable', host, port });
  }
  if (code === 'ETIMEDOUT') return new DriverAdapterError({ kind: 'SocketTimeout' });
  if (code === 'ECONNRESET') return new DriverAdapterError({ kind: 'ConnectionClosed' });
  return error;
}

/**
 * Adapter for sslmode=prefer/allow. node-postgres has no TLS fallback, so the first database
 * operation negotiates like libpq (once per process) and then delegates to a regular PrismaPg
 * adapter. Negotiation failures surface through Prisma's normal error mapping and are retried
 * by the next operation.
 */
class NegotiatingPgAdapter implements SqlDriverAdapter {
  readonly provider = 'postgres' as const;
  readonly adapterName = ADAPTER_NAME;
  #inner: SqlDriverAdapter | undefined;
  #pending: Promise<SqlDriverAdapter> | undefined;

  constructor(
    private readonly negotiate: () => Promise<SqlDriverAdapter>,
    private readonly info: ConnectionInfo
  ) {}

  #adapter(): Promise<SqlDriverAdapter> {
    if (this.#inner) return Promise.resolve(this.#inner);
    this.#pending ??= this.negotiate().then(
      adapter => (this.#inner = adapter),
      error => {
        this.#pending = undefined;
        throw error;
      }
    );
    return this.#pending;
  }

  async queryRaw(query: SqlQuery) {
    return (await this.#adapter()).queryRaw(query);
  }
  async executeRaw(query: SqlQuery) {
    return (await this.#adapter()).executeRaw(query);
  }
  async executeScript(script: string) {
    return (await this.#adapter()).executeScript(script);
  }
  async startTransaction(isolationLevel?: Parameters<SqlDriverAdapter['startTransaction']>[0]) {
    return (await this.#adapter()).startTransaction(isolationLevel);
  }
  getConnectionInfo(): ConnectionInfo {
    return this.info;
  }
  async dispose() {
    const inner = this.#inner ?? (await this.#pending?.catch(() => undefined));
    this.#inner = undefined;
    this.#pending = undefined;
    await inner?.dispose();
  }
}

export interface OpsKnightAdapterOptions {
  applicationName?: string;
  /** Override the URL's connection_limit (role-specific pool sizes). */
  poolSize?: number;
}

const TEXT_ARRAY_OID = 1009;
const parseTextArray = pg.types.getTypeParser(
  TEXT_ARRAY_OID as Parameters<typeof pg.types.getTypeParser>[0]
) as (value: string) => unknown;
const enumArrayTypes = new Map<number, boolean>();

/**
 * Prisma 5 decoded arrays of PostgreSQL enums (e.g. `array_agg(status)`, NotificationChannel[]
 * columns read through raw SQL) as string arrays; node-postgres returns the array literal text.
 * Enum array type OIDs are looked up once per process and parsed with the text[] parser.
 */
async function parseUserDefinedType(oid: number, value: unknown, queryable: SqlQueryable) {
  if (typeof value !== 'string') return value;
  let isEnumArray = enumArrayTypes.get(oid);
  if (isEnumArray === undefined) {
    const result = await queryable.queryRaw({
      sql: `SELECT EXISTS (SELECT 1 FROM pg_type a JOIN pg_type e ON e.oid = a.typelem WHERE a.oid = $1::oid AND e.typtype = 'e')`,
      args: [String(oid)],
      argTypes: [{ scalarType: 'string', arity: 'scalar' }],
    });
    isEnumArray = result.rows[0]?.[0] === true;
    enumArrayTypes.set(oid, isEnumArray);
  }
  return isEnumArray ? parseTextArray(value) : value;
}

class OpsKnightPgAdapterFactory implements SqlMigrationAwareDriverAdapterFactory {
  readonly provider = 'postgres' as const;
  readonly adapterName = ADAPTER_NAME;

  constructor(private readonly plan: PgConnectionPlan) {}

  #create(ssl: pg.PoolConfig['ssl']): PrismaPg {
    const pool = new OpsKnightPgPool({ ...this.plan.pool, ssl });
    return new PrismaPg(pool, {
      schema: this.plan.schema,
      disposeExternalPool: true,
      userDefinedTypeParser: parseUserDefinedType,
      onPoolError: error =>
        emit('warn', 'db.pool.idle_client_error', {
          target: this.plan.target,
          error: error.message,
        }),
      onConnectionError: error =>
        emit('warn', 'db.pool.connection_error', {
          target: this.plan.target,
          error: error.message,
        }),
    });
  }

  async #negotiatedSsl(): Promise<pg.PoolConfig['ssl']> {
    const { tls, pool, target } = this.plan;
    const host = String(pool.host);
    const port = Number(pool.port);
    try {
      if (tls.mode === 'prefer') {
        const encrypted = await probeServerTls(host, port, pool.connectionTimeoutMillis ?? 10_000);
        if (encrypted && !tls.verifiesCertificate && !host.startsWith('/')) {
          emit('info', 'db.tls.negotiated', {
            target,
            mode: 'prefer',
            encrypted: true,
            verified: false,
          });
        }
        return encrypted ? tls.options : false;
      }
      // allow: libpq tries plaintext first and upgrades only if the server rejects it.
      const probe = new pg.Client({ ...pool, ssl: false });
      try {
        await probe.connect();
        return false;
      } catch (error) {
        if ((error as { code?: unknown }).code === '28000') return tls.options;
        throw error;
      } finally {
        await probe.end().catch(() => undefined);
      }
    } catch (error) {
      throw toDriverAdapterError(error, host, port);
    }
  }

  async connect(): Promise<SqlDriverAdapter> {
    const { tls } = this.plan;
    if (tls.mode !== 'prefer' && tls.mode !== 'allow') {
      return instrumentAdapter(
        await this.#create(tls.mode === 'disable' ? false : tls.options).connect()
      );
    }
    return instrumentAdapter(
      new NegotiatingPgAdapter(async () => this.#create(await this.#negotiatedSsl()).connect(), {
        schemaName: this.plan.schema,
        supportsRelationJoins: true,
      })
    );
  }

  async connectToShadowDb(): Promise<SqlDriverAdapter> {
    const { tls } = this.plan;
    const ssl =
      tls.mode === 'disable'
        ? false
        : tls.mode === 'prefer' || tls.mode === 'allow'
          ? await this.#negotiatedSsl()
          : tls.options;
    return this.#create(ssl).connectToShadowDb();
  }
}

const warnedTargets = new Set<string>();

/** Defers configuration errors to first use, as Prisma 5 did for invalid or missing URLs. */
function failingAdapterFactory(error: Error): SqlMigrationAwareDriverAdapterFactory {
  const fail = async (): Promise<never> => {
    throw error;
  };
  return {
    provider: 'postgres',
    adapterName: ADAPTER_NAME,
    connect: fail,
    connectToShadowDb: fail,
  };
}

/** Build the Prisma driver adapter for an OpsKnight DATABASE_URL. */
export function createPgAdapter(
  url: string | undefined,
  options: OpsKnightAdapterOptions = {}
): SqlMigrationAwareDriverAdapterFactory {
  if (!url) {
    return failingAdapterFactory(
      new Error('DATABASE_URL is not set; it is required to connect to PostgreSQL.')
    );
  }
  let plan: PgConnectionPlan;
  try {
    plan = planPgConnection(url, { applicationName: options.applicationName });
  } catch (error) {
    emit('error', 'db.config.invalid', { message: (error as Error).message });
    return failingAdapterFactory(error as Error);
  }
  if (options.poolSize) plan.pool.max = options.poolSize;
  for (const warning of plan.warnings) {
    const key = `${plan.target}:${warning}`;
    if (warnedTargets.has(key)) continue;
    warnedTargets.add(key);
    emit('warn', 'db.config.warning', { target: plan.target, message: warning });
  }
  return new OpsKnightPgAdapterFactory(plan);
}

export interface CreatePrismaClientOptions extends OpsKnightAdapterOptions {
  /** Defaults to process.env.DATABASE_URL. */
  url?: string;
  /** Defaults applied to interactive transactions (explicit per-call options win). */
  transactionOptions?: {
    maxWait?: number;
    timeout?: number;
    isolationLevel?: Prisma.TransactionIsolationLevel;
  };
}

type LogDefinitions = Array<Prisma.LogLevel | Prisma.LogDefinition>;

/**
 * Single construction point for every PrismaClient in OpsKnight (app roles, workers, scripts
 * and tests). Prisma 7 requires a driver adapter; this keeps URL semantics identical to Prisma 5.
 */
export function createPrismaClient<const Log extends LogDefinitions = []>(
  options: CreatePrismaClientOptions & { log?: Log } = {}
): PrismaClient<
  { adapter: SqlMigrationAwareDriverAdapterFactory; log: Log },
  Prisma.GetEvents<Log>
> {
  const client = new PrismaClient<
    { adapter: SqlMigrationAwareDriverAdapterFactory; log: Log },
    Prisma.GetEvents<Log>
  >({
    adapter: createPgAdapter(options.url ?? process.env.DATABASE_URL, options),
    log: (options.log ?? []) as Log,
  });
  return withOpsKnightBehaviour(client, options.transactionOptions);
}

const RAW_METHODS: readonly PropertyKey[] = [
  '$queryRaw',
  '$executeRaw',
  '$queryRawUnsafe',
  '$executeRawUnsafe',
];

function registerRawCall(method: PropertyKey, args: unknown[]) {
  const sql = rawSqlTextFromCall(String(method), args);
  if (sql) registerRawSql(sql);
}

/**
 * Transparent view of a PrismaClient that
 * - registers raw SQL text synchronously at call time, so the adapter applies Prisma 5 parameter
 *   typing (raw-parameter-types.ts) to exactly those statements;
 * - converts bare DriverAdapterErrors from transactions (notably a serialization conflict at
 *   COMMIT) into the PrismaClientKnownRequestError Prisma raises for the same failure elsewhere,
 *   so every caller's retry logic keeps working.
 * The PrismaClient itself is never modified: Prisma derives interactive-transaction clients from
 * it, and overriding its methods would route transaction queries outside the transaction.
 */
function withOpsKnightBehaviour<T extends object>(
  client: T,
  transactionDefaults?: CreatePrismaClientOptions['transactionOptions']
): T {
  const transaction = Reflect.get(client, '$transaction', client) as (
    ...args: unknown[]
  ) => Promise<unknown>;
  const wrapped = new Map<PropertyKey, unknown>([
    [
      '$transaction',
      (input: unknown, ...rest: unknown[]) => {
        const interactive = typeof input === 'function';
        const run = interactive
          ? (tx: object) => (input as (tx: object) => unknown)(trackRawSqlInTransaction(tx))
          : input;
        const [callOptions, ...more] = rest;
        const effective =
          interactive && transactionDefaults
            ? [{ ...transactionDefaults, ...(callOptions as object | undefined) }, ...more]
            : rest;
        return transaction.call(client, run, ...effective).catch((error: unknown) => {
          throw toPrismaClientError(error);
        });
      },
    ],
    ...RAW_METHODS.map(method => {
      const original = Reflect.get(client, method, client) as (...args: unknown[]) => unknown;
      return [
        method,
        (...args: unknown[]) => {
          registerRawCall(method, args);
          return original.apply(client, args);
        },
      ] as const;
    }),
  ]);
  return new Proxy(client, {
    get(target, property) {
      if (wrapped.has(property)) return wrapped.get(property);
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function trackRawSqlInTransaction<T extends object>(tx: T): T {
  return new Proxy(tx, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (!RAW_METHODS.includes(property)) return value;
      return (...args: unknown[]) => {
        registerRawCall(property, args);
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}
