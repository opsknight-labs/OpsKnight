import 'server-only';
import type { AnyOpsInsightProducer } from '../producer';
import { automationRuleHealthProducer } from './automation-rule-health';
import { automationSuggestedRulesProducer } from './automation-suggested-rules';
import { escalationPolicyProducer } from './escalation-policy';
import { integrationHealthProducer } from './integration-health';
import { onCallPersonProducer, onCallScheduleProducer } from './oncall';
import { repeatCauseProducer } from './postmortem-repeat-cause';
import { missingRunbookProducer } from './missing-runbook';
import { runbookHealthProducer } from './runbook-health';
import { serviceNoiseProducer, userNoiseProducer } from './notification-noise';
import { acceptanceDriftProducer } from './acceptance-drift';
import { metricEarlyWarningProducer } from './metric-early-warning';

/**
 * The kinds registry. To add a kind: add one file in this directory that exports an OpsInsightProducer,
 * and list it here. Kinds must be unique (asserted by the unit test).
 */
export const OPS_INSIGHT_PRODUCERS: readonly AnyOpsInsightProducer[] = [
  integrationHealthProducer,
  automationRuleHealthProducer,
  automationSuggestedRulesProducer,
  escalationPolicyProducer,
  onCallScheduleProducer,
  onCallPersonProducer,
  repeatCauseProducer,
  runbookHealthProducer,
  missingRunbookProducer,
  userNoiseProducer,
  serviceNoiseProducer,
  acceptanceDriftProducer,
  metricEarlyWarningProducer,
];
