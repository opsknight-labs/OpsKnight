import 'server-only';
import type { Prisma } from '@prisma/client';
import type {
  OpsInsightArea,
  OpsInsightItem,
  OpsInsightScope,
  OpsInsightScopeType,
} from './contract';

export interface OpsInsightProducerContext {
  /** The lane's budgeted transaction: statement and lock timeouts already apply. Read only. */
  tx: Prisma.TransactionClient;
  /** The database clock at the start of the work item. */
  now: Date;
}

/**
 * One kind of insight for one scope type. A later slice adds a kind by adding one file under `producers/`
 * and listing it in `producers/index.ts`.
 *
 * The two halves are split so that unchanged inputs cost no writes:
 * - `loadInput` does the reads: bounded, index-backed, a fixed number of statements (never one per row).
 *   It returns a small JSON-serializable summary, or null when the scope has nothing to evaluate.
 *   Everything `derive` depends on must be in it, including time: express ages as coarse numbers
 *   ("silent for 26 hours"), because the lane skips `derive` while the summary is unchanged.
 * - `derive` is pure: no clock, no database, no model. It turns the summary into insights.
 *
 * Producers never write, never call a model and never notify. An insight may carry a `draftHref` to a
 * pre-filled editor; a person publishes there.
 */
export interface OpsInsightProducer<Input = unknown> {
  /** Stable, namespaced identifier, such as `integration.health`. */
  kind: string;
  /** Bump when `derive` changes what it says for the same input, so stored insights are recomputed. */
  version: number;
  area: OpsInsightArea;
  scopeType: OpsInsightScopeType;
  loadInput(scope: OpsInsightScope, ctx: OpsInsightProducerContext): Promise<Input | null>;
  derive(input: Input): OpsInsightItem[];
}

/** A producer with its input type erased: the lane treats inputs as opaque JSON. */
export interface AnyOpsInsightProducer extends Omit<
  OpsInsightProducer<unknown>,
  'loadInput' | 'derive'
> {
  loadInput(scope: OpsInsightScope, ctx: OpsInsightProducerContext): Promise<unknown>;
  derive(input: never): OpsInsightItem[];
}
