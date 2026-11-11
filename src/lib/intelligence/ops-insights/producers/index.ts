import 'server-only';
import type { AnyOpsInsightProducer } from '../producer';
import { integrationHealthProducer } from './integration-health';

/**
 * The kinds registry. To add a kind: add one file in this directory that exports an OpsInsightProducer,
 * and list it here. Kinds must be unique (asserted by the unit test).
 */
export const OPS_INSIGHT_PRODUCERS: readonly AnyOpsInsightProducer[] = [integrationHealthProducer];
