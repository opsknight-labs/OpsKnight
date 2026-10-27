import { observeOperationalHistogram } from '@/lib/metrics/operational/registry';
import { IngestionUnavailableError } from './contract';

type Caller<T, R> = {
  value: T;
  bytes: number;
  queuedAt: number;
  resolve: (result: R) => void;
  reject: (error: unknown) => void;
};

/** Bounded group commits: pending limits include work already inside PostgreSQL.
 * This queue is never an acknowledgement or a source of reusable quota credit.
 */
export class DurableAppendBatcher<T, R> {
  private queue: Caller<T, R>[] = [];
  private pending = 0;
  private bytes = 0;
  private active = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly commit: (values: T[]) => Promise<R[]>) {}

  enqueue(value: T, bytes: number): Promise<R> {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 4 * 1024 * 1024)
      return Promise.reject(new IngestionUnavailableError('Invalid ingestion append size'));
    if (this.pending >= 256 || this.bytes + bytes > 32 * 1024 * 1024)
      return Promise.reject(new IngestionUnavailableError('Durable ingestion append busy'));
    this.pending++;
    this.bytes += bytes;
    return new Promise((resolve, reject) => {
      this.queue.push({ value, bytes, queuedAt: performance.now(), resolve, reject });
      if (!this.timer)
        this.timer = setTimeout(() => {
          this.timer = undefined;
          this.flush();
        }, 2);
    });
  }

  private flush(): void {
    while (this.active < 2 && this.queue.length) {
      let size = 0;
      let count = 0;
      for (const item of this.queue) {
        if (count >= 32 || (count && size + item.bytes > 4 * 1024 * 1024)) break;
        count++;
        size += item.bytes;
      }
      const callers = this.queue.splice(0, count);
      this.active++;
      const dispatchedAt = performance.now();
      for (const caller of callers)
        observeOperationalHistogram(
          'opsknight_ingestion_admission_stage_duration_ms',
          dispatchedAt - caller.queuedAt,
          { stage: 'append-wait', outcome: 'success' }
        );
      // The promise boundary also contains a synchronous commit adapter failure.
      void Promise.resolve()
        .then(() => this.commit(callers.map(item => item.value)))
        .then(results => {
          if (results.length !== callers.length) throw new Error('Missing durable append results');
          callers.forEach((caller, index) => caller.resolve(results.at(index)!));
        })
        .catch(error => callers.forEach(caller => caller.reject(error)))
        .finally(() => {
          this.pending -= callers.length;
          this.bytes -= size;
          this.active--;
          if (!this.timer) this.flush();
        });
    }
  }
}
