import type { CorrelationRule } from '../contract';
import { computeSignature, extendedWindowEnd, isCriticalIncident, windowFor } from '../correlation/rules';

/**
 * Pure replay of a rule set over historical incidents. It reuses the live engine's own signature and
 * window functions, so the preview predicts what the engine would do, and it excludes critical
 * incidents exactly as the engine does. Nothing is written.
 */

export interface ReplayIncident {
  id: string;
  serviceId: string;
  urgency: string;
  createdAt: Date;
  template: string;
  labels: Readonly<Record<string, string>>;
}

export interface ReplayGroup {
  ruleId: string;
  serviceId: string;
  size: number;
  firstAt: Date;
  lastAt: Date;
}

export interface ReplayResult {
  incidentsEvaluated: number;
  /** Highest-urgency incidents are never grouped. */
  criticalExcluded: number;
  /** Groups with two or more incidents. */
  groups: number;
  /** Incidents that would belong to a multi-incident group (anchors included). */
  groupedIncidents: number;
  /**
   * Links SUGGEST mode would propose. A link is a (member, anchor) pair and is stored once, so two
   * rules that group the same incidents together propose one link, not two.
   */
  suggestedLinks: number;
  /** Largest groups first, for sanity-checking a rule before publishing. */
  topGroups: ReplayGroup[];
  perRule: Array<{ ruleId: string; groups: number; groupedIncidents: number }>;
}

interface OpenGroup {
  ruleId: string;
  serviceId: string;
  windowStart: number;
  windowEnd: Date;
  maxWindowEnd: Date;
  members: string[];
  firstAt: Date;
  lastAt: Date;
}

const TOP_GROUPS = 10;

export function simulateCorrelation(incidents: readonly ReplayIncident[], rules: readonly CorrelationRule[]): ReplayResult {
  const active = rules.filter(rule => rule.enabled);
  const ordered = [...incidents].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1)
  );
  const groupsByKey = new Map<string, OpenGroup[]>();
  let criticalExcluded = 0;

  for (const incident of ordered) {
    if (isCriticalIncident(incident)) {
      criticalExcluded += 1;
      continue;
    }
    for (const rule of active) {
      const signature = computeSignature(rule, {
        serviceId: incident.serviceId,
        template: incident.template,
        labels: incident.labels,
      });
      if (!signature) continue;
      const key = `${rule.id}\u0000${incident.serviceId}\u0000${signature}`;
      const list = groupsByKey.get(key) ?? [];
      const time = incident.createdAt.getTime();
      // Same containment rule as the live engine: latest group whose window covers this instant.
      let group = [...list].reverse().find(g => g.windowStart <= time && g.windowEnd.getTime() >= time);
      if (!group) {
        const window = windowFor(incident.createdAt, rule);
        group = {
          ruleId: rule.id,
          serviceId: incident.serviceId,
          windowStart: window.windowStart.getTime(),
          windowEnd: window.windowEnd,
          maxWindowEnd: window.maxWindowEnd,
          members: [],
          firstAt: incident.createdAt,
          lastAt: incident.createdAt,
        };
        list.push(group);
        groupsByKey.set(key, list);
      }
      group.windowEnd = extendedWindowEnd(group, incident.createdAt, rule.windowSeconds);
      group.members.push(incident.id);
      group.lastAt = incident.createdAt;
    }
  }

  const all = [...groupsByKey.values()].flat().filter(group => group.members.length >= 2);
  const grouped = new Set<string>();
  const links = new Set<string>();
  const perRule = new Map<string, { groups: number; grouped: Set<string> }>();
  for (const group of all) {
    const entry = perRule.get(group.ruleId) ?? { groups: 0, grouped: new Set<string>() };
    entry.groups += 1;
    const [anchor, ...rest] = group.members;
    for (const member of group.members) {
      grouped.add(member);
      entry.grouped.add(member);
    }
    for (const member of rest) links.add(`${member}\u0000${anchor}`);
    perRule.set(group.ruleId, entry);
  }

  return {
    incidentsEvaluated: ordered.length,
    criticalExcluded,
    groups: all.length,
    groupedIncidents: grouped.size,
    suggestedLinks: links.size,
    topGroups: [...all]
      .sort((a, b) => b.members.length - a.members.length || a.firstAt.getTime() - b.firstAt.getTime())
      .slice(0, TOP_GROUPS)
      .map(group => ({
        ruleId: group.ruleId,
        serviceId: group.serviceId,
        size: group.members.length,
        firstAt: group.firstAt,
        lastAt: group.lastAt,
      })),
    perRule: active.map(rule => {
      const entry = perRule.get(rule.id);
      return { ruleId: rule.id, groups: entry?.groups ?? 0, groupedIncidents: entry?.grouped.size ?? 0 };
    }),
  };
}
