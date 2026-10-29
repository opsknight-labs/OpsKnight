import http from 'node:http';
import { createSmtpEmulatorServer, handleHttpEmailRequest } from './email';
import { handlePushEmulatorRequest } from './push';
import {
  ALL_PROVIDERS,
  getAllProvidersTelemetry,
  ProviderBehaviorConfig,
  ProviderMode,
  ProviderName,
  resetProviderTelemetry,
  scheduleProviderOutage,
  setProviderBehavior,
} from './shared';
import { handleSlackEmulatorRequest } from './slack';
import { handleSmsEmulatorRequest } from './sms';
import { handleTeamsEmulatorRequest } from './teams';
import { handleWebhookEmulatorRequest } from './webhook';

function readRawBody(req: http.IncomingMessage): Promise<string> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', () => resolve(''));
  });
}

function normalizeProviderMode(rawMode: unknown): ProviderMode | undefined {
  if (typeof rawMode !== 'string') return undefined;
  switch (rawMode) {
    case 'normal':
    case '200_fast':
      return 'normal';
    case 'slow':
    case '200_slow':
      return 'slow';
    case 'rate_limit':
    case '429_rate_limit':
      return 'rate_limit';
    case 'transient_failure':
    case 'mixed':
      return 'transient_failure';
    case 'permanent_failure':
      return 'permanent_failure';
    case 'timeout':
      return 'timeout';
    case 'outage':
    case '503_outage':
      return 'outage';
    default:
      return undefined;
  }
}

async function handleControlRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  rawBody: string
): Promise<void> {
  if (req.method === 'GET' && (pathname === '/health' || pathname === '/_control/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        providers: ALL_PROVIDERS,
        timestamp: new Date().toISOString(),
      })
    );
    return;
  }

  if (req.method === 'GET' && (pathname === '/metrics' || pathname === '/_control/metrics')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        timestamp: new Date().toISOString(),
        providers: getAllProvidersTelemetry(),
      })
    );
    return;
  }

  let body: Record<string, unknown> = {};
  if (rawBody) {
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      body = {};
    }
  }

  if (req.method === 'POST' && (pathname === '/behavior' || pathname === '/_control/behavior')) {
    const target = body.provider as ProviderName | 'all' | undefined;
    const patch: Partial<ProviderBehaviorConfig> = {};
    const mode = normalizeProviderMode(body.mode);
    if (mode) patch.mode = mode;
    if (typeof body.latencyMs === 'number') patch.latencyMs = body.latencyMs;
    if (typeof body.failureRate === 'number') patch.failureRate = body.failureRate;
    else if (typeof body.errorRate === 'number') patch.failureRate = body.errorRate;
    if (typeof body.rateLimitPerSec === 'number') patch.rateLimitPerSec = body.rateLimitPerSec;
    if (typeof body.retryAfterSec === 'number') patch.retryAfterSec = body.retryAfterSec;
    else if (typeof body.retryAfterSeconds === 'number') {
      patch.retryAfterSec = body.retryAfterSeconds;
    }

    const validTarget: ProviderName | 'all' =
      !target || target === 'all'
        ? 'all'
        : ALL_PROVIDERS.includes(target)
          ? target
          : 'all';

    setProviderBehavior(validTarget, patch);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'updated',
        target: validTarget,
        providers: getAllProvidersTelemetry(),
      })
    );
    return;
  }

  if (req.method === 'POST' && (pathname === '/outage' || pathname === '/_control/outage')) {
    const target = body.provider as ProviderName | 'all' | undefined;
    const durationSeconds =
      typeof body.durationSeconds === 'number'
        ? body.durationSeconds
        : typeof body.durationMs === 'number'
          ? Math.ceil(body.durationMs / 1000)
          : 60;
    const normalizedMode = normalizeProviderMode(body.mode);
    const outageMode: 'outage' | 'rate_limit' | 'timeout' =
      normalizedMode === 'rate_limit' || normalizedMode === 'timeout'
        ? normalizedMode
        : 'outage';

    const validTarget: ProviderName | 'all' =
      !target || target === 'all'
        ? 'all'
        : ALL_PROVIDERS.includes(target)
          ? target
          : 'all';

    scheduleProviderOutage(validTarget, durationSeconds, outageMode);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'outage_scheduled',
        target: validTarget,
        durationSeconds,
        mode: outageMode,
      })
    );
    return;
  }

  if (req.method === 'POST' && (pathname === '/reset' || pathname === '/_control/reset')) {
    const target = body.provider as ProviderName | 'all' | undefined;
    const validTarget: ProviderName | 'all' =
      target && target !== 'all' && ALL_PROVIDERS.includes(target) ? target : 'all';
    resetProviderTelemetry(validTarget);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'reset',
        providers: getAllProvidersTelemetry(),
      })
    );
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Unknown control endpoint' }));
}

export async function routeProviderHttpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const rawBody = await readRawBody(req);
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;
  const host = (req.headers.host ?? '').toLowerCase();

  if (pathname.startsWith('/_control/') || pathname === '/health' || pathname === '/metrics') {
    await handleControlRequest(req, res, pathname, rawBody);
    return;
  }

  if (pathname.startsWith('/slack') || host.includes('slack')) {
    await handleSlackEmulatorRequest(req, res, rawBody);
    return;
  }

  if (
    pathname.startsWith('/sms') ||
    pathname.startsWith('/2010-04-01') ||
    host.includes('sms') ||
    host.includes('twilio')
  ) {
    await handleSmsEmulatorRequest(req, res, rawBody);
    return;
  }

  if (pathname.startsWith('/push') || host.includes('push')) {
    await handlePushEmulatorRequest(req, res, rawBody);
    return;
  }

  if (pathname.startsWith('/teams') || host.includes('teams')) {
    await handleTeamsEmulatorRequest(req, res, rawBody);
    return;
  }

  if (pathname.startsWith('/email') || pathname.startsWith('/v3/mail') || host.includes('email')) {
    await handleHttpEmailRequest(req, res, rawBody);
    return;
  }

  if (pathname.startsWith('/webhook') || pathname.startsWith('/status-webhook') || host.includes('webhook')) {
    await handleWebhookEmulatorRequest(req, res, rawBody);
    return;
  }

  await handleWebhookEmulatorRequest(req, res, rawBody);
}

export interface ProviderEmulatorSuiteHandle {
  httpPort: number;
  controlPort: number;
  smtpPort: number;
  close: () => Promise<void>;
}

export async function startProviderEmulatorSuite(options?: {
  httpPort?: number;
  controlPort?: number;
  smtpPort?: number;
  host?: string;
}): Promise<ProviderEmulatorSuiteHandle> {
  const host = options?.host ?? process.env.PROVIDER_BIND_HOST ?? '0.0.0.0';
  const httpPort = options?.httpPort ?? Number(process.env.PROVIDER_HTTP_PORT ?? 8086);
  const controlPort = options?.controlPort ?? Number(process.env.PROVIDER_CONTROL_PORT ?? 8088);
  const smtpPort = options?.smtpPort ?? Number(process.env.PROVIDER_SMTP_PORT ?? 2525);

  const httpServer = http.createServer((req, res) => {
    void routeProviderHttpRequest(req, res);
  });

  const controlServer = http.createServer(async (req, res) => {
    const rawBody = await readRawBody(req);
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    await handleControlRequest(req, res, url.pathname, rawBody);
  });

  const smtpServer = createSmtpEmulatorServer();

  await Promise.all([
    new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(httpPort, host, () => resolve());
    }),
    new Promise<void>((resolve, reject) => {
      controlServer.once('error', reject);
      controlServer.listen(controlPort, host, () => resolve());
    }),
    new Promise<void>((resolve, reject) => {
      smtpServer.once('error', reject);
      smtpServer.listen(smtpPort, host, () => resolve());
    }),
  ]);

  const actualHttpPort = (httpServer.address() as { port: number } | null)?.port ?? httpPort;
  const actualControlPort =
    (controlServer.address() as { port: number } | null)?.port ?? controlPort;
  const actualSmtpPort = (smtpServer.address() as { port: number } | null)?.port ?? smtpPort;

  return {
    httpPort: actualHttpPort,
    controlPort: actualControlPort,
    smtpPort: actualSmtpPort,
    close: async () => {
      await Promise.all([
        new Promise<void>(resolve => httpServer.close(() => resolve())),
        new Promise<void>(resolve => controlServer.close(() => resolve())),
        new Promise<void>(resolve => smtpServer.close(() => resolve())),
      ]);
    },
  };
}

if (require.main === module) {
  startProviderEmulatorSuite()
    .then(handle => {
      console.log(
        JSON.stringify({
          event: 'provider_emulator_suite.started',
          httpPort: handle.httpPort,
          controlPort: handle.controlPort,
          smtpPort: handle.smtpPort,
        })
      );

      const shutdown = () => {
        void handle.close().finally(() => process.exit(0));
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    })
    .catch(err => {
      console.error('Failed to start provider emulator suite:', err);
      process.exit(1);
    });
}
