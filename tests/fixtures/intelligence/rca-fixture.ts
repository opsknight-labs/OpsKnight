/**
 * Labelled root-cause scenarios for response analysis. Each scenario is a small world (services, declared
 * dependencies, recorded changes around one incident) with the change a responder should look at first; the
 * integration test (`tests/integration/intelligence/engine-fixtures.test.ts`) runs the real analysis and
 * checks that the top-ranked change is that one, and reports top-1 accuracy over the set.
 *
 * Minutes are before the incident's onset (negative means after it). `service: null` is a global change.
 */
export interface RcaChange {
  label: string;
  service: string | null;
  minutesBefore: number;
  kind?: 'DEPLOY' | 'CONFIG' | 'FEATURE_FLAG' | 'INFRA';
  source?: string;
}

export interface RcaScenario {
  id: string;
  /** Service names; the incident opens on the first. */
  services: string[];
  /** [upstream, downstream] pairs. */
  dependencies?: Array<[string, string]>;
  changes: RcaChange[];
  /** Earlier changes per [source, service], spread over the last 30 days (they set how routine a source is). */
  history?: Array<{ source: string; service: string; count: number }>;
  /** Label of the change that must rank first, or null when nothing should be offered. */
  expectedTopCause: string | null;
  why: string;
}

export const RCA_SCENARIOS: readonly RcaScenario[] = [
  {
    id: 'same-service-deploy-wins',
    services: ['web', 'api', 'billing'],
    dependencies: [['api', 'web']],
    changes: [
      { label: 'web deploy', service: 'web', minutesBefore: 10 },
      { label: 'api deploy', service: 'api', minutesBefore: 20 },
      { label: 'global config', service: null, minutesBefore: 5, kind: 'CONFIG' },
      { label: 'billing deploy', service: 'billing', minutesBefore: 5 },
      { label: 'ancient web deploy', service: 'web', minutesBefore: 600 },
      { label: 'web deploy after onset', service: 'web', minutesBefore: -1 },
    ],
    expectedTopCause: 'web deploy',
    why: 'A recent change on the affected service outranks upstream, global, unrelated, stale and later ones.',
  },
  {
    id: 'upstream-beats-unrelated',
    services: ['web', 'api', 'billing'],
    dependencies: [['api', 'web']],
    changes: [
      { label: 'api deploy', service: 'api', minutesBefore: 20 },
      { label: 'billing deploy', service: 'billing', minutesBefore: 2 },
    ],
    expectedTopCause: 'api deploy',
    why: 'A change on a service with no dependency path is never a candidate, however close in time.',
  },
  {
    id: 'fresh-upstream-beats-stale-local',
    services: ['web', 'api'],
    dependencies: [['api', 'web']],
    changes: [
      { label: 'old web deploy', service: 'web', minutesBefore: 300 },
      { label: 'api deploy', service: 'api', minutesBefore: 10 },
    ],
    expectedTopCause: 'api deploy',
    why: 'Time proximity dominates: a five-hour-old local deploy loses to a fresh upstream one.',
  },
  {
    id: 'nearer-hop-wins',
    services: ['web', 'api', 'db'],
    dependencies: [
      ['api', 'web'],
      ['db', 'api'],
    ],
    changes: [
      { label: 'db deploy', service: 'db', minutesBefore: 15 },
      { label: 'api deploy', service: 'api', minutesBefore: 15 },
    ],
    expectedTopCause: 'api deploy',
    why: 'At equal lead time, one hop upstream outranks two.',
  },
  {
    id: 'config-change-only',
    services: ['web'],
    changes: [
      { label: 'web pool config', service: 'web', minutesBefore: 30, kind: 'CONFIG' },
      { label: 'web deploy after onset', service: 'web', minutesBefore: -2 },
    ],
    expectedTopCause: 'web pool config',
    why: 'A change after onset cannot have caused it.',
  },
  {
    id: 'global-flag-only',
    services: ['web'],
    changes: [{ label: 'global flag', service: null, minutesBefore: 20, kind: 'FEATURE_FLAG' }],
    expectedTopCause: 'global flag',
    why: 'A global change is a weak but valid candidate when nothing local happened.',
  },
  {
    id: 'routine-source-discounted',
    services: ['web'],
    changes: [
      { label: 'chatty ci deploy', service: 'web', minutesBefore: 8, source: 'chatty-ci' },
      { label: 'release train deploy', service: 'web', minutesBefore: 12, source: 'release-train' },
    ],
    history: [{ source: 'chatty-ci', service: 'web', count: 120 }],
    expectedTopCause: 'release train deploy',
    why: 'A source that changes something every few hours is weaker evidence than a rare release.',
  },
  {
    id: 'nothing-relevant',
    services: ['web', 'billing'],
    changes: [
      { label: 'billing deploy', service: 'billing', minutesBefore: 5 },
      { label: 'web deploy seven hours ago', service: 'web', minutesBefore: 420 },
    ],
    expectedTopCause: null,
    why: 'Unrelated or out-of-window changes are not offered as causes at all.',
  },
];

/** Every scenario must rank its labelled cause first. */
export const RCA_MIN_TOP1_ACCURACY = 1;
