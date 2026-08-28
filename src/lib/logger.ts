import {
  getRequestContext,
  runWithContext,
  requestContextStorage,
  type RequestContext,
} from './request-context';

export {
  getRequestContext,
  runWithContext,
  requestContextStorage,
  type RequestContext,
} from './request-context';

function trustedRequestId(request: Request): string {
  const supplied = request.headers.get('x-request-id')?.trim();
  if (supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied)) return supplied;
  return crypto.randomUUID();
}

/** Wrap a Node route handler with per-request structured-log correlation. */
export function withRequestContext<R extends Request, A extends unknown[], T>(
  handler: (request: R, ...args: A) => Promise<T>,
  component: string
) {
  return async (request: R, ...args: A): Promise<T> => {
    const requestId = trustedRequestId(request);
    return runWithContext({ requestId, component }, async () => {
      const result = await handler(request, ...args);
      if (result instanceof Response) {
        try {
          if (!result.headers.has('x-request-id')) result.headers.set('x-request-id', requestId);
        } catch {
          // Some runtime-generated responses expose immutable headers. Logs
          // still retain the correlation id in that case.
        }
      }
      return result;
    });
  };
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: LogContext;
  component?: string;
  requestId?: string;
  userId?: string;
  duration?: number;
  error?: {
    message: string;
    stack?: string;
    name?: string;
  };
}

interface LoggerConfig {
  level: LogLevel;
  format: 'json' | 'pretty';
  context?: LogContext;
}

interface Timer {
  done: (message?: string, context?: LogContext) => void;
}

const parsedMax = Number.parseInt(process.env.LOG_BUFFER_MAX || '500', 10);
const LOG_BUFFER_MAX =
  Number.isFinite(parsedMax) && parsedMax >= 0 ? Math.min(parsedMax, 5000) : 500;
const logBuffer: LogEntry[] = [];

function getBufferLimit(limit?: number) {
  const safeLimit = Number.isFinite(limit) ? Math.floor(limit as number) : LOG_BUFFER_MAX;
  return Math.max(0, Math.min(safeLimit, LOG_BUFFER_MAX));
}

const SENSITIVE_KEYS = [
  /pass(word)?/i,
  /token/i,
  /secret/i,
  /key/i,
  /auth(orization)?/i,
  /credential/i,
  /signature/i,
  /private_?key/i,
  /email/i,
  /phone(_?number)?/i,
  /mobile/i,
  /tel/i,
  /\bto\b/i,
  /session/i,
  /cookie/i,
  /jwt/i,
  /bearer/i,
  /ssn/i,
  /credit_?card|cvv|cvc/i,
  /webhook_?url/i,
];

const SECRET_PATTERNS = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\b/g, // Email (strictly disjoint domain labels)
  /Bearer\s+[A-Za-z0-9\-_.]+/gi, // Bearer tokens
  /Basic\s+[A-Za-z0-9+/=]{16,}/gi, // Basic Auth tokens
  /\bok_[A-Za-z0-9_-]{20,}\b/g, // OpsKnight API Keys
  /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*/g, // Slack tokens
  /AKIA[0-9A-Z]{16}/g, // AWS Access Keys
  /(?:https?:\/\/[^\s?#]+\?[^\s#]*(?:token|secret|key|sig|signature|api_key)=)[^&\s]+/gi, // URL query tokens (bounded by ? and #)
];

export function sanitizeString(val: string): string {
  if (typeof val !== 'string' || val.length === 0) return val;
  // Bound string length to prevent ReDoS on huge uncontrolled inputs
  const input = val.length > 50000 ? val.slice(0, 50000) : val;
  let result = input;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

export function sanitizeContext(context: unknown, seen = new WeakSet<object>()): unknown {
  // JSON.stringify throws on bigint values. Logging must never turn a valid
  // application operation (database ids, advisory lock keys, counters) into
  // an application failure.
  if (typeof context === 'bigint') {
    return context.toString();
  }
  if (!context || typeof context !== 'object') {
    if (typeof context === 'string') {
      return sanitizeString(context);
    }
    return context;
  }

  if (context instanceof Error) {
    return {
      name: context.name,
      message: sanitizeString(context.message),
      stack: context.stack ? sanitizeString(context.stack) : undefined,
    };
  }

  if (seen.has(context)) {
    return '[CIRCULAR]';
  }
  seen.add(context);

  if (Array.isArray(context)) {
    return context.map(item => sanitizeContext(item, seen));
  }

  return Object.fromEntries(
    Object.entries(context as Record<string, unknown>).map(([key, value]) => {
      let sanitizedValue: unknown;
      if (SENSITIVE_KEYS.some(regex => regex.test(key))) {
        sanitizedValue = '[REDACTED]';
      } else if (typeof value === 'bigint') {
        sanitizedValue = value.toString();
      } else if (typeof value === 'object' && value !== null) {
        sanitizedValue = sanitizeContext(value, seen);
      } else if (typeof value === 'string') {
        sanitizedValue = sanitizeString(value);
      } else {
        sanitizedValue = value;
      }
      return [key, sanitizedValue];
    })
  );
}

function addToBuffer(entry: LogEntry) {
  if (LOG_BUFFER_MAX <= 0) {
    return;
  }
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_MAX) {
    logBuffer.splice(0, logBuffer.length - LOG_BUFFER_MAX);
  }
}

export function getLogBuffer(limit?: number) {
  const sliceLimit = getBufferLimit(limit);
  if (sliceLimit === 0) {
    return [];
  }
  return logBuffer.slice(-sliceLimit);
}

class Logger {
  private config: LoggerConfig;
  private persistentContext: LogContext;

  constructor(config?: Partial<LoggerConfig>, persistentContext?: LogContext) {
    const nodeEnv = process.env.NODE_ENV || 'development';
    const logLevel = (process.env.LOG_LEVEL?.toLowerCase() as LogLevel) || 'info';
    const logFormat =
      process.env.LOG_FORMAT?.toLowerCase() === 'json'
        ? 'json'
        : nodeEnv === 'production'
          ? 'json'
          : 'pretty';

    this.config = {
      level: config?.level || logLevel,
      format: config?.format || logFormat,
      context: config?.context || {},
    };
    this.persistentContext = persistentContext || {};
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    const currentLevelIndex = levels.indexOf(this.config.level);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex >= currentLevelIndex;
  }

  private formatPretty(entry: LogEntry): string {
    const timestamp = new Date(entry.timestamp).toLocaleTimeString();

    // Level colors and emojis
    const levelConfig: Record<LogLevel, { color: string; emoji: string; label: string }> = {
      debug: { color: '\x1b[36m', emoji: '🔍', label: 'DEBUG' },
      info: { color: '\x1b[32m', emoji: 'ℹ️ ', label: 'INFO ' },
      warn: { color: '\x1b[33m', emoji: '⚠️ ', label: 'WARN ' },
      error: { color: '\x1b[31m', emoji: '❌', label: 'ERROR' },
    };

    const reset = '\x1b[0m';
    const gray = '\x1b[90m';
    const { color, emoji, label } = levelConfig[entry.level];

    let output = `${gray}[${timestamp}]${reset} ${color}${emoji} ${label}${reset} ${entry.message}`;

    // Add component if present
    if (entry.component) {
      output += ` ${gray}[${entry.component}]${reset}`;
    }

    // Add duration if present
    if (entry.duration !== undefined) {
      output += ` ${gray}(${entry.duration}ms)${reset}`;
    }

    // Add context
    const contextData = { ...entry.context };
    if (entry.requestId) contextData.requestId = entry.requestId;
    if (entry.userId) contextData.userId = entry.userId;

    if (Object.keys(contextData).length > 0) {
      output += `\n  ${gray}${JSON.stringify(contextData, null, 2).split('\n').join('\n  ')}${reset}`;
    }

    // Add error details
    if (entry.error) {
      output += `\n  ${color}Error: ${entry.error.message}${reset}`;
      if (entry.error.stack) {
        output += `\n  ${gray}${entry.error.stack.split('\n').slice(1).join('\n  ')}${reset}`;
      }
    }

    return output;
  }

  private formatJson(entry: LogEntry): string {
    return JSON.stringify(entry);
  }

  private emit(entry: LogEntry): void {
    if (!this.shouldLog(entry.level)) {
      return;
    }

    const formatted =
      this.config.format === 'json' ? this.formatJson(entry) : this.formatPretty(entry);

    switch (entry.level) {
      case 'error':
        console.error(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      case 'debug':
        console.debug(formatted);
        break;
      default:
        console.log(formatted);
        break;
    }

    // Send client-side logs to the server
    if (typeof window !== 'undefined') {
      // Only send logs that meet the configured level
      // For now, let's limit to warn/error to avoid spamming the server
      // unless configured otherwise, but the user requested migration of console.error
      // so ensuring errors are sent is key.

      // Use fire-and-forget to avoid blocking interaction
      // Use keepalive to ensure logs are sent even if page unloads
      fetch('/api/logs/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
        keepalive: true,
      }).catch(() => {
        // Silently fail if log ingestion fails to avoid infinite loops
      });
    }
  }

  private serializeError(error: unknown): LogEntry['error'] | undefined {
    if (!error) return undefined;

    if (error instanceof Error) {
      return {
        message: error.message,
        stack: error.stack,
        name: error.name,
      };
    }

    if (typeof error === 'string') {
      return { message: error };
    }

    return {
      message: String(error),
    };
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    const ctx = requestContextStorage.getStore() ?? {};
    const rawContext: LogContext = {
      ...this.persistentContext,
      ...this.config.context,
      ...(ctx as LogContext),
      ...context,
    };

    let component: string | undefined;
    let requestId: string | undefined;
    let userId: string | undefined;
    let duration: number | undefined;
    let error: LogEntry['error'] | undefined;

    if (rawContext.component) {
      component = String(rawContext.component);
      delete rawContext.component;
    }
    if (rawContext.requestId) {
      requestId = String(rawContext.requestId);
      delete rawContext.requestId;
    }
    if (rawContext.userId) {
      userId = String(rawContext.userId);
      delete rawContext.userId;
    }
    if (rawContext.duration !== undefined) {
      duration = Number(rawContext.duration);
      delete rawContext.duration;
    }
    if (rawContext.error) {
      error = this.serializeError(rawContext.error);
      delete rawContext.error;
    }

    const sanitizedMessage = sanitizeString(message);
    const sanitizedContext =
      Object.keys(rawContext).length > 0 ? (sanitizeContext(rawContext) as LogContext) : undefined;

    const sanitizedError = error
      ? {
          ...error,
          message: sanitizeString(error.message),
          stack: error.stack ? sanitizeString(error.stack) : undefined,
        }
      : undefined;

    const entry: LogEntry = {
      level,
      message: sanitizedMessage,
      timestamp: new Date().toISOString(),
      context: sanitizedContext,
      component,
      requestId,
      userId,
      duration,
      error: sanitizedError,
    };

    addToBuffer(entry);
    this.emit(entry);
  }

  /**
   * Log a debug message (lowest priority)
   * Use for detailed diagnostic information
   */
  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  /**
   * Log an informational message
   * Use for general application flow and state changes
   */
  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  /**
   * Log a warning message
   * Use for potentially harmful situations or deprecated features
   */
  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  /**
   * Log an error message (highest priority)
   * Use for error events that might still allow the application to continue
   */
  error(message: string, context?: LogContext): void {
    this.log('error', message, context);
  }

  /**
   * Create a child logger with persistent context
   * Useful for component-specific or request-scoped logging
   */
  child(context: LogContext): Logger {
    return new Logger(this.config, { ...this.persistentContext, ...context });
  }

  /**
   * Start a performance timer
   * Returns a timer object with a done() method to log completion time
   */
  startTimer(): Timer & { start: number } {
    const start = Date.now();

    return {
      start,
      done: (message?: string, context?: LogContext) => {
        const duration = Date.now() - start;
        const logMessage = message || 'Operation completed';
        this.info(logMessage, { ...context, duration });
      },
    };
  }

  /**
   * Measure the execution time of an async function
   */
  async measure<T>(operation: string, fn: () => Promise<T>, context?: LogContext): Promise<T> {
    const timer = this.startTimer();
    try {
      const result = await fn();
      timer.done(`${operation} completed`, context);
      return result;
    } catch (error) {
      const duration = Date.now() - (timer as any).start; // eslint-disable-line @typescript-eslint/no-explicit-any
      this.error(`${operation} failed`, { ...context, error, duration });
      throw error;
    }
  }
}

// Default logger instance
export const logger = new Logger();

// Export Logger class
export { Logger };

// Export types for consumers
export type { LogLevel, LogContext };

// Helper function to create a logger with persistent context
export function createLogger(context: LogContext): Logger {
  return new Logger(undefined, context);
}
