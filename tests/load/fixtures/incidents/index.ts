import type { LoadServiceFixture } from '../services';
import type { LoadUserFixture, ScaleDimensions } from '../users';

export interface LoadIncidentFixture {
  id: string;
  title: string;
  description: string;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'SNOOZED';
  urgency: 'HIGH' | 'MEDIUM' | 'LOW';
  priority: 'P1' | 'P2' | 'P3';
  visibility: 'PUBLIC' | 'PRIVATE';
  dedupKey: string;
  serviceId: string;
  teamId: string | null;
  assigneeId: string | null;
  escalationStatus: 'ESCALATING' | 'COMPLETED';
  currentEscalationStep: number;
  nextEscalationAt: Date | null;
  createdAt: Date;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
}

const INCIDENT_TEMPLATES = [
  {
    title: 'Database Connection Pool Exhaustion',
    description: 'Active connections exceeded 95% of max_connections on primary cluster.',
    urgency: 'HIGH' as const,
    priority: 'P1' as const,
  },
  {
    title: 'API Gateway p99 Latency Breach (>2500ms)',
    description: 'Upstream checkout and payment endpoints exceeding SLO threshold.',
    urgency: 'HIGH' as const,
    priority: 'P1' as const,
  },
  {
    title: 'Elevated HTTP 502/503 Error Rate in eu-west-1',
    description: 'Ingress controller reporting 14.2% 5xx rate across edge nodes.',
    urgency: 'MEDIUM' as const,
    priority: 'P2' as const,
  },
  {
    title: 'Kafka Consumer Group Lag Growing',
    description: 'Telemetry partition lag crossed 250,000 messages.',
    urgency: 'LOW' as const,
    priority: 'P3' as const,
  },
];

export function buildBaselineIncidentFixtures(
  scale: ScaleDimensions,
  services: LoadServiceFixture[],
  users: LoadUserFixture[],
  now = new Date()
): LoadIncidentFixture[] {
  const incidents: LoadIncidentFixture[] = [];
  const responders = users.filter(u => u.role !== 'USER');
  const pool = responders.length > 0 ? responders : users;

  for (let i = 0; i < scale.baselineIncidents; i++) {
    const index = i + 1;
    const template = INCIDENT_TEMPLATES[i % INCIDENT_TEMPLATES.length];
    const service = services[i % services.length];
    const assignee = pool[i % pool.length];

    const statusMod = i % 4;
    const status: LoadIncidentFixture['status'] =
      statusMod === 0 || statusMod === 1
        ? 'OPEN'
        : statusMod === 2
          ? 'ACKNOWLEDGED'
          : 'RESOLVED';

    const createdAt = new Date(now.getTime() - (scale.baselineIncidents - i) * 15_000);
    const acknowledgedAt =
      status === 'ACKNOWLEDGED' || status === 'RESOLVED'
        ? new Date(createdAt.getTime() + 5_000)
        : null;
    const resolvedAt = status === 'RESOLVED' ? new Date(createdAt.getTime() + 10_000) : null;
    const assignToTeam = status === 'OPEN' && i % 2 === 0;

    incidents.push({
      id: `lt-incident-${String(index).padStart(5, '0')}`,
      title: `[LoadCert #${index}] ${template.title}`,
      description: template.description,
      status,
      urgency: template.urgency,
      priority: template.priority,
      visibility: 'PUBLIC',
      dedupKey: `lt-baseline-dedup-${String(index).padStart(5, '0')}`,
      serviceId: service.id,
      teamId: assignToTeam ? service.teamId : null,
      assigneeId: assignToTeam ? null : assignee.id,
      escalationStatus: status === 'OPEN' ? 'ESCALATING' : 'COMPLETED',
      currentEscalationStep: 0,
      nextEscalationAt: status === 'OPEN' ? new Date(now.getTime() + 60_000) : null,
      createdAt,
      acknowledgedAt,
      resolvedAt,
    });
  }

  return incidents;
}
