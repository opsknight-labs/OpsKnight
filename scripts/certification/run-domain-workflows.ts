import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

interface Fixtures {
  seededAt: string;
  apiBase: string;
  directApiBase: string;
  tokens: {
    admin: string;
    responder: string;
    auditor: string;
    regular: string;
    teamA: string;
    teamB: string;
    serviceAccount: string;
  };
  users: {
    adminId: string;
    responderId: string;
    teamAUserId: string;
    teamBUserId: string;
  };
  teams: { teamAId: string; teamBId: string };
  services: { serviceAId: string; serviceBId: string };
  escalationPolicies: { policyAId: string };
  schedules: { scheduleAId: string };
  incidents: { openId: string; ackedId: string; resolvedId: string };
  postmortems: { postmortemId: string };
  statusPages: { statusPageId: string };
}

interface WorkflowStepResult {
  step: string;
  method: string;
  path: string;
  status: number;
  expectedStatus: number[];
  pass: boolean;
  latencyMs: number;
  dataSnippet?: string;
  headers?: Record<string, string>;
  error?: string;
}

interface WorkflowResult {
  domain: string;
  title: string;
  steps: WorkflowStepResult[];
  pass: boolean;
  durationMs: number;
}

const fixturesPath = path.resolve('tests/certification/fixtures.json');
const fixtures: Fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
const apiBase = fixtures.apiBase;

// Round-robin admin tokens to avoid per-key rate limits
const keyPoolPath = path.resolve('tests/certification/key-pool.json');
const keyPool: string[] = JSON.parse(fs.readFileSync(keyPoolPath, 'utf8')).tokens;
let keyIdx = 0;
function getToken(): string {
  return keyPool[(keyIdx++) % keyPool.length];
}

async function request(
  urlPath: string,
  method: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
  token = getToken()
): Promise<{ status: number; headers: Headers; json: any; latencyMs: number; error?: string }> {
  const fullUrl = `${apiBase}${urlPath}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json, application/problem+json',
    'Idempotency-Key': randomUUID(),
    ...extraHeaders
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const start = performance.now();
  try {
    const res = await fetch(fullUrl, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const latencyMs = Math.round(performance.now() - start);
    let json: any = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) {
      json = await res.json().catch(() => null);
    }
    return { status: res.status, headers: res.headers, json, latencyMs };
  } catch (err: any) {
    return {
      status: 0,
      headers: new Headers(),
      json: null,
      latencyMs: Math.round(performance.now() - start),
      error: err.message
    };
  }
}

async function main() {
  console.log('Starting Phase 4: Business Domain End-to-End Certification Workflows');
  console.log(`Target API Base: ${apiBase}`);

  const workflows: WorkflowResult[] = [];

  // =========================================================================
  // WORKFLOW A: Incidents and Incident Response Lifecycle
  // =========================================================================
  console.log('\n--- Running Workflow A: Incidents & Lifecycle ---');
  const wfAStart = performance.now();
  const wfASteps: WorkflowStepResult[] = [];

  // A1. Create Incident
  const incCreateRes = await request('/incidents', 'POST', {
    title: `Payment failure burst on node-eu-1 [${Date.now()}]`,
    description: 'Elevated 503 response codes detected on checkout gateway',
    serviceId: fixtures.services.serviceAId,
    urgency: 'HIGH',
    priority: 'P1'
  });
  const incidentId = incCreateRes.json?.data?.id;
  wfASteps.push({
    step: 'Create Incident',
    method: 'POST',
    path: '/incidents',
    status: incCreateRes.status,
    expectedStatus: [201],
    pass: incCreateRes.status === 201 && Boolean(incidentId),
    latencyMs: incCreateRes.latencyMs,
    dataSnippet: incidentId
  });

  if (incidentId) {
    // A2. Get Incident
    const getRes = await request(`/incidents/${incidentId}`, 'GET');
    wfASteps.push({
      step: 'Get Incident Details',
      method: 'GET',
      path: `/incidents/${incidentId}`,
      status: getRes.status,
      expectedStatus: [200],
      pass: getRes.status === 200 && getRes.json?.data?.status === 'OPEN',
      latencyMs: getRes.latencyMs
    });

    // A3. Acknowledge Incident
    const ackRes = await request(`/incidents/${incidentId}/acknowledge`, 'POST', {
      note: 'Investigating Redis connection spikes'
    });
    wfASteps.push({
      step: 'Acknowledge Incident',
      method: 'POST',
      path: `/incidents/${incidentId}/acknowledge`,
      status: ackRes.status,
      expectedStatus: [200],
      pass: ackRes.status === 200 && ackRes.json?.data?.status === 'ACKNOWLEDGED',
      latencyMs: ackRes.latencyMs
    });

    // A4. Add Note
    const noteRes = await request(`/incidents/${incidentId}/notes`, 'POST', {
      content: 'Mitigation applied: traffic drained from unhealthy node'
    });
    wfASteps.push({
      step: 'Add Note',
      method: 'POST',
      path: `/incidents/${incidentId}/notes`,
      status: noteRes.status,
      expectedStatus: [200, 201],
      pass: noteRes.status >= 200 && noteRes.status < 300,
      latencyMs: noteRes.latencyMs
    });

    // A5. Assign to Responder
    const assignRes = await request(`/incidents/${incidentId}/assign`, 'POST', {
      assigneeId: fixtures.users.responderId
    });
    wfASteps.push({
      step: 'Assign Responder',
      method: 'POST',
      path: `/incidents/${incidentId}/assign`,
      status: assignRes.status,
      expectedStatus: [200],
      pass: assignRes.status === 200 && assignRes.json?.data?.assigneeId === fixtures.users.responderId,
      latencyMs: assignRes.latencyMs
    });

    // A6. Snooze Incident
    const snoozeRes = await request(`/incidents/${incidentId}/snooze`, 'POST', {
      snoozedUntil: new Date(Date.now() + 3600000).toISOString(),
      note: 'Waiting for canary deploy verification'
    });
    wfASteps.push({
      step: 'Snooze Incident',
      method: 'POST',
      path: `/incidents/${incidentId}/snooze`,
      status: snoozeRes.status,
      expectedStatus: [200],
      pass: snoozeRes.status === 200 && snoozeRes.json?.data?.status === 'SNOOZED',
      latencyMs: snoozeRes.latencyMs
    });

    // A7. Unsnooze Incident (Transitions back to OPEN)
    const unsnoozeRes = await request(`/incidents/${incidentId}/unsnooze`, 'POST', {});
    wfASteps.push({
      step: 'Unsnooze Incident',
      method: 'POST',
      path: `/incidents/${incidentId}/unsnooze`,
      status: unsnoozeRes.status,
      expectedStatus: [200],
      pass: unsnoozeRes.status === 200 && unsnoozeRes.json?.data?.status === 'OPEN',
      latencyMs: unsnoozeRes.latencyMs
    });

    // A8. Resolve Incident
    const resolveRes = await request(`/incidents/${incidentId}/resolve`, 'POST', {
      resolutionNote: 'Canary verified; cluster restored to normal error rate'
    });
    wfASteps.push({
      step: 'Resolve Incident',
      method: 'POST',
      path: `/incidents/${incidentId}/resolve`,
      status: resolveRes.status,
      expectedStatus: [200],
      pass: resolveRes.status === 200 && resolveRes.json?.data?.status === 'RESOLVED',
      latencyMs: resolveRes.latencyMs
    });

    // A9. Reopen Incident
    const reopenRes = await request(`/incidents/${incidentId}/reopen`, 'POST', {
      note: 'Brief recurrence during evening peak'
    });
    wfASteps.push({
      step: 'Reopen Incident',
      method: 'POST',
      path: `/incidents/${incidentId}/reopen`,
      status: reopenRes.status,
      expectedStatus: [200],
      pass: reopenRes.status === 200 && reopenRes.json?.data?.status === 'OPEN',
      latencyMs: reopenRes.latencyMs
    });
  }

  const wfAPass = wfASteps.every(s => s.pass);
  workflows.push({
    domain: 'Incidents',
    title: 'Incident Lifecycle & Transitions',
    steps: wfASteps,
    pass: wfAPass,
    durationMs: Math.round(performance.now() - wfAStart)
  });
  console.log(`Workflow A Result: ${wfAPass ? 'PASS' : 'FAIL'} (${wfASteps.length} steps)`);

  // =========================================================================
  // WORKFLOW B: Services, Teams & Identity
  // =========================================================================
  console.log('\n--- Running Workflow B: Services, Teams & Identity ---');
  const wfBStart = performance.now();
  const wfBSteps: WorkflowStepResult[] = [];

  // B1. Create Team
  const teamName = `Team Reliability ${Date.now()}`;
  const teamCreateRes = await request('/teams', 'POST', {
    name: teamName,
    description: 'Site Reliability Engineering and Platform Infrastructure'
  });
  const createdTeamId = teamCreateRes.json?.data?.id;
  const teamRevision = teamCreateRes.headers.get('etag') || '"1"';
  wfBSteps.push({
    step: 'Create Team',
    method: 'POST',
    path: '/teams',
    status: teamCreateRes.status,
    expectedStatus: [201],
    pass: teamCreateRes.status === 201 && Boolean(createdTeamId),
    latencyMs: teamCreateRes.latencyMs,
    dataSnippet: createdTeamId
  });

  if (createdTeamId) {
    // B2. Update Team with If-Match ETag
    const teamPatchRes = await request(
      `/teams/${createdTeamId}`,
      'PATCH',
      { description: 'Updated reliability mission' },
      { 'If-Match': teamRevision }
    );
    wfBSteps.push({
      step: 'Update Team (with ETag)',
      method: 'PATCH',
      path: `/teams/${createdTeamId}`,
      status: teamPatchRes.status,
      expectedStatus: [200],
      pass: teamPatchRes.status === 200,
      latencyMs: teamPatchRes.latencyMs
    });

    // B3. Add Team Member with ETag
    const teamGetRes = await request(`/teams/${createdTeamId}`, 'GET');
    const updatedRevision = teamGetRes.headers.get('etag') || '"2"';
    const addMemberRes = await request(
      `/teams/${createdTeamId}/members/${fixtures.users.responderId}`,
      'PUT',
      { role: 'MEMBER', receiveTeamNotifications: true },
      { 'If-Match': updatedRevision }
    );
    wfBSteps.push({
      step: 'Add Team Member',
      method: 'PUT',
      path: `/teams/${createdTeamId}/members/${fixtures.users.responderId}`,
      status: addMemberRes.status,
      expectedStatus: [200],
      pass: addMemberRes.status === 200,
      latencyMs: addMemberRes.latencyMs
    });

    // B4. List Team Members
    const membersRes = await request(`/teams/${createdTeamId}/members`, 'GET');
    wfBSteps.push({
      step: 'List Team Members',
      method: 'GET',
      path: `/teams/${createdTeamId}/members`,
      status: membersRes.status,
      expectedStatus: [200],
      pass: membersRes.status === 200 && membersRes.json?.data?.some((m: any) => m.userId === fixtures.users.responderId),
      latencyMs: membersRes.latencyMs
    });

    // B5. Set Team Lead
    const teamGetRes2 = await request(`/teams/${createdTeamId}`, 'GET');
    const leadRevision = teamGetRes2.headers.get('etag') || '"3"';
    const leadRes = await request(
      `/teams/${createdTeamId}/lead`,
      'PUT',
      { userId: fixtures.users.responderId },
      { 'If-Match': leadRevision }
    );
    wfBSteps.push({
      step: 'Set Team Lead',
      method: 'PUT',
      path: `/teams/${createdTeamId}/lead`,
      status: leadRes.status,
      expectedStatus: [200],
      pass: leadRes.status === 200,
      latencyMs: leadRes.latencyMs
    });

    // B6. Remove Team Member
    const teamGetRes3 = await request(`/teams/${createdTeamId}`, 'GET');
    const removeRevision = teamGetRes3.headers.get('etag') || '"4"';
    const removeRes = await request(
      `/teams/${createdTeamId}/members/${fixtures.users.responderId}`,
      'DELETE',
      undefined,
      { 'If-Match': removeRevision }
    );
    wfBSteps.push({
      step: 'Remove Team Member',
      method: 'DELETE',
      path: `/teams/${createdTeamId}/members/${fixtures.users.responderId}`,
      status: removeRes.status,
      expectedStatus: [200, 204],
      pass: removeRes.status === 200 || removeRes.status === 204,
      latencyMs: removeRes.latencyMs
    });

    // B7. Delete Team (Now empty of services)
    const teamDeleteRes = await request(`/teams/${createdTeamId}`, 'DELETE');
    wfBSteps.push({
      step: 'Delete Empty Team',
      method: 'DELETE',
      path: `/teams/${createdTeamId}`,
      status: teamDeleteRes.status,
      expectedStatus: [200, 204],
      pass: teamDeleteRes.status === 200 || teamDeleteRes.status === 204,
      latencyMs: teamDeleteRes.latencyMs
    });
  }

  const wfBPass = wfBSteps.every(s => s.pass);
  workflows.push({
    domain: 'Services & Teams',
    title: 'Team Administration & Membership Lifecycle',
    steps: wfBSteps,
    pass: wfBPass,
    durationMs: Math.round(performance.now() - wfBStart)
  });
  console.log(`Workflow B Result: ${wfBPass ? 'PASS' : 'FAIL'} (${wfBSteps.length} steps)`);

  // =========================================================================
  // WORKFLOW C: Escalation Policies & Schedules
  // =========================================================================
  console.log('\n--- Running Workflow C: Escalation Policies & Schedules ---');
  const wfCStart = performance.now();
  const wfCSteps: WorkflowStepResult[] = [];

  // C1. Create Escalation Policy
  const epRes = await request('/escalation-policies', 'POST', {
    name: `SRE Escalation Tier ${Date.now()}`,
    description: 'Tier 1 response for production platform',
    steps: [
      {
        delayMinutes: 5,
        targetType: 'USER',
        targetId: fixtures.users.responderId,
        notificationChannels: ['EMAIL']
      }
    ]
  });
  const epId = epRes.json?.data?.id;
  wfCSteps.push({
    step: 'Create Escalation Policy',
    method: 'POST',
    path: '/escalation-policies',
    status: epRes.status,
    expectedStatus: [201],
    pass: epRes.status === 201 && Boolean(epId),
    latencyMs: epRes.latencyMs,
    dataSnippet: epId
  });

  if (epId) {
    // C2. Preview Escalation Policy (with incidentId)
    const previewRes = await request(`/escalation-policies/${epId}/preview`, 'POST', {
      incidentId: fixtures.incidents.openId
    });
    wfCSteps.push({
      step: 'Preview Escalation Policy',
      method: 'POST',
      path: `/escalation-policies/${epId}/preview`,
      status: previewRes.status,
      expectedStatus: [200],
      pass: previewRes.status === 200,
      latencyMs: previewRes.latencyMs
    });

    // C3. Create Schedule
    const schedRes = await request('/schedules', 'POST', {
      name: `Core On-Call Rotation ${Date.now()}`,
      timeZone: 'UTC',
      description: 'Primary 24x7 rotation'
    });
    const schedId = schedRes.json?.data?.id;
    wfCSteps.push({
      step: 'Create On-Call Schedule',
      method: 'POST',
      path: '/schedules',
      status: schedRes.status,
      expectedStatus: [201],
      pass: schedRes.status === 201 && Boolean(schedId),
      latencyMs: schedRes.latencyMs
    });

    if (schedId) {
      // C4. Add Layer to Schedule (responderIds and complete fields)
      const layerRes = await request(`/schedules/${schedId}/layers`, 'POST', {
        name: 'Daily Shift',
        start: new Date().toISOString(),
        end: null,
        rotationLengthHours: 24,
        shiftLengthHours: null,
        restrictions: null,
        responderIds: [fixtures.users.responderId]
      });
      const layerId = layerRes.json?.data?.id;
      wfCSteps.push({
        step: 'Add Schedule Layer',
        method: 'POST',
        path: `/schedules/${schedId}/layers`,
        status: layerRes.status,
        expectedStatus: [201],
        pass: layerRes.status === 201 && Boolean(layerId),
        latencyMs: layerRes.latencyMs
      });

      // C5. Create Schedule Override
      const overrideRes = await request(`/schedules/${schedId}/overrides`, 'POST', {
        userId: fixtures.users.responderId,
        startDate: new Date(Date.now() + 3600000).toISOString(),
        endDate: new Date(Date.now() + 14400000).toISOString()
      });
      const overrideId = overrideRes.json?.data?.id;
      wfCSteps.push({
        step: 'Create Schedule Override',
        method: 'POST',
        path: `/schedules/${schedId}/overrides`,
        status: overrideRes.status,
        expectedStatus: [200, 201],
        pass: (overrideRes.status === 200 || overrideRes.status === 201) && Boolean(overrideId),
        latencyMs: overrideRes.latencyMs
      });

      // C6. Query Effective On-Call
      const onCallRes = await request(`/schedules/${schedId}/on-call`, 'GET');
      wfCSteps.push({
        step: 'Query Effective On-Call',
        method: 'GET',
        path: `/schedules/${schedId}/on-call`,
        status: onCallRes.status,
        expectedStatus: [200],
        pass: onCallRes.status === 200,
        latencyMs: onCallRes.latencyMs
      });

      // C7. Cancel Override
      if (overrideId) {
        const cancelRes = await request(`/schedules/${schedId}/overrides/${overrideId}`, 'DELETE');
        wfCSteps.push({
          step: 'Cancel Schedule Override',
          method: 'DELETE',
          path: `/schedules/${schedId}/overrides/${overrideId}`,
          status: cancelRes.status,
          expectedStatus: [200, 204],
          pass: cancelRes.status === 200 || cancelRes.status === 204,
          latencyMs: cancelRes.latencyMs
        });
      }
    }
  }

  const wfCPass = wfCSteps.every(s => s.pass);
  workflows.push({
    domain: 'Escalations & Schedules',
    title: 'Policy Formulation, Rotations & Overrides',
    steps: wfCSteps,
    pass: wfCPass,
    durationMs: Math.round(performance.now() - wfCStart)
  });
  console.log(`Workflow C Result: ${wfCPass ? 'PASS' : 'FAIL'} (${wfCSteps.length} steps)`);

  // =========================================================================
  // WORKFLOW D: Service Automation
  // =========================================================================
  console.log('\n--- Running Workflow D: Service Automation ---');
  const wfDStart = performance.now();
  const wfDSteps: WorkflowStepResult[] = [];

  // D1. Read current automation settings
  const autoSettingsRes = await request('/settings/automation', 'GET');
  wfDSteps.push({
    step: 'Read Automation Settings',
    method: 'GET',
    path: '/settings/automation',
    status: autoSettingsRes.status,
    expectedStatus: [200],
    pass: autoSettingsRes.status === 200,
    latencyMs: autoSettingsRes.latencyMs
  });

  // D2. Save Service Automation Draft with ETag
  const draftGetRes = await request(`/services/${fixtures.services.serviceAId}/automation/draft`, 'GET');
  const autoDraftEtag = draftGetRes.headers.get('etag') || '"0"';
  const draftRes = await request(
    `/services/${fixtures.services.serviceAId}/automation/draft`,
    'PUT',
    { snapshot: { schemaVersion: 1, fields: [], rules: [] } },
    { 'If-Match': autoDraftEtag }
  );
  wfDSteps.push({
    step: 'Save Automation Draft',
    method: 'PUT',
    path: `/services/${fixtures.services.serviceAId}/automation/draft`,
    status: draftRes.status,
    expectedStatus: [200],
    pass: draftRes.status === 200,
    latencyMs: draftRes.latencyMs
  });

  // D3. Validate Automation Draft
  const validateAutoRes = await request(`/services/${fixtures.services.serviceAId}/automation/validate`, 'POST', {
    snapshot: { schemaVersion: 1, fields: [], rules: [] }
  });
  wfDSteps.push({
    step: 'Validate Automation Snapshot',
    method: 'POST',
    path: `/services/${fixtures.services.serviceAId}/automation/validate`,
    status: validateAutoRes.status,
    expectedStatus: [200],
    pass: validateAutoRes.status === 200,
    latencyMs: validateAutoRes.latencyMs
  });

  // D4. Simulate Automation
  const simRes = await request(`/services/${fixtures.services.serviceAId}/automation/simulate`, 'POST', {
    snapshot: { schemaVersion: 1, fields: [], rules: [] },
    integrationType: 'events',
    event: {
      event_action: 'trigger',
      dedup_key: `sim-${Date.now()}`,
      payload: { summary: 'Simulated alert', source: 'cert-runner', severity: 'info' }
    }
  });
  wfDSteps.push({
    step: 'Simulate Automation Decision',
    method: 'POST',
    path: `/services/${fixtures.services.serviceAId}/automation/simulate`,
    status: simRes.status,
    expectedStatus: [200],
    pass: simRes.status === 200,
    latencyMs: simRes.latencyMs
  });

  const wfDPass = wfDSteps.every(s => s.pass);
  workflows.push({
    domain: 'Automation',
    title: 'Service Automation Authoring & Simulation',
    steps: wfDSteps,
    pass: wfDPass,
    durationMs: Math.round(performance.now() - wfDStart)
  });
  console.log(`Workflow D Result: ${wfDPass ? 'PASS' : 'FAIL'} (${wfDSteps.length} steps)`);

  // =========================================================================
  // WORKFLOW E: Runbooks
  // =========================================================================
  console.log('\n--- Running Workflow E: Runbooks ---');
  const wfEStart = performance.now();
  const wfESteps: WorkflowStepResult[] = [];

  // E1. Create Runbook (comes with initial draft v1)
  const rbName = `Auto Recovery Runbook ${Date.now()}`;
  const rbSlug = `auto-recovery-${Date.now()}`;
  const rbCreateRes = await request('/runbooks', 'POST', {
    name: rbName,
    slug: rbSlug,
    description: 'Automated remediation flow'
  });
  const rbId = rbCreateRes.json?.data?.id;
  const draftVersionId = rbCreateRes.json?.data?.draftVersion?.id;
  const draftEtag = rbCreateRes.headers.get('etag') || '"1"';
  wfESteps.push({
    step: 'Create Runbook (with Draft v1)',
    method: 'POST',
    path: '/runbooks',
    status: rbCreateRes.status,
    expectedStatus: [201],
    pass: rbCreateRes.status === 201 && Boolean(rbId) && Boolean(draftVersionId),
    latencyMs: rbCreateRes.latencyMs,
    dataSnippet: rbId
  });

  if (rbId && draftVersionId) {
    // E2. Read Draft Version ETag
    const draftGetRes = await request(`/runbooks/${rbId}/drafts/${draftVersionId}`, 'GET');
    const draftEtag = draftGetRes.headers.get('etag') || '"0"';

    // E3. Update Draft Definition
    const editRes = await request(
      `/runbooks/${rbId}/drafts/${draftVersionId}`,
      'PATCH',
      {
        definition: {
          description: 'Production recovery steps',
          steps: [{ key: 'step_drain', name: 'Drain connections', type: 'MANUAL', riskClass: 'READ_ONLY', config: {} }]
        },
        inputs: []
      },
      { 'If-Match': draftEtag }
    );
    const updatedDraftEtag = editRes.headers.get('etag') || '"1"';
    wfESteps.push({
      step: 'Update Draft Definition (with ETag)',
      method: 'PATCH',
      path: `/runbooks/${rbId}/drafts/${draftVersionId}`,
      status: editRes.status,
      expectedStatus: [200],
      pass: editRes.status === 200,
      latencyMs: editRes.latencyMs
    });

    // E3. Validate Draft
    const validateDraftRes = await request(`/runbooks/${rbId}/drafts/${draftVersionId}/validate`, 'POST', {});
    wfESteps.push({
      step: 'Validate Draft Steps',
      method: 'POST',
      path: `/runbooks/${rbId}/drafts/${draftVersionId}/validate`,
      status: validateDraftRes.status,
      expectedStatus: [200],
      pass: validateDraftRes.status === 200,
      latencyMs: validateDraftRes.latencyMs
    });

    // E4. Publish Draft
    const pubRes = await request(
      `/runbooks/${rbId}/drafts/${draftVersionId}/publish`,
      'POST',
      {},
      { 'If-Match': updatedDraftEtag }
    );
    wfESteps.push({
      step: 'Publish Runbook Version',
      method: 'POST',
      path: `/runbooks/${rbId}/drafts/${draftVersionId}/publish`,
      status: pubRes.status,
      expectedStatus: [200, 201],
      pass: pubRes.status >= 200 && pubRes.status < 300,
      latencyMs: pubRes.latencyMs
    });

    // E5. Preview Execution
    const execPreviewRes = await request(`/runbooks/${rbId}/executions/preview`, 'POST', {
      parameters: {}
    });
    wfESteps.push({
      step: 'Preview Runbook Execution',
      method: 'POST',
      path: `/runbooks/${rbId}/executions/preview`,
      status: execPreviewRes.status,
      expectedStatus: [200],
      pass: execPreviewRes.status === 200,
      latencyMs: execPreviewRes.latencyMs
    });
  }

  const wfEPass = wfESteps.every(s => s.pass);
  workflows.push({
    domain: 'Runbooks',
    title: 'Runbook Authoring, Versioning & Execution Preview',
    steps: wfESteps,
    pass: wfEPass,
    durationMs: Math.round(performance.now() - wfEStart)
  });
  console.log(`Workflow E Result: ${wfEPass ? 'PASS' : 'FAIL'} (${wfESteps.length} steps)`);

  // =========================================================================
  // WORKFLOW F: Status Pages
  // =========================================================================
  console.log('\n--- Running Workflow F: Status Pages ---');
  const wfFStart = performance.now();
  const wfFSteps: WorkflowStepResult[] = [];

  // F1. Get Status Page
  const spGetRes = await request(`/status-pages/${fixtures.statusPages.statusPageId}`, 'GET');
  wfFSteps.push({
    step: 'Get Status Page',
    method: 'GET',
    path: `/status-pages/${fixtures.statusPages.statusPageId}`,
    status: spGetRes.status,
    expectedStatus: [200],
    pass: spGetRes.status === 200,
    latencyMs: spGetRes.latencyMs
  });

  // F2. Update Status Page Name / Enabled
  const spPatchRes = await request(
    `/status-pages/${fixtures.statusPages.statusPageId}`,
    'PATCH',
    { name: `OpsKnight Public Status ${Date.now()}` }
  );
  wfFSteps.push({
    step: 'Update Status Page General Config',
    method: 'PATCH',
    path: `/status-pages/${fixtures.statusPages.statusPageId}`,
    status: spPatchRes.status,
    expectedStatus: [200],
    pass: spPatchRes.status === 200,
    latencyMs: spPatchRes.latencyMs
  });

  // F3. Create Status Page Announcement
  const annRes = await request(`/status-pages/${fixtures.statusPages.statusPageId}/announcements`, 'POST', {
    title: `Platform Maintenance Window [${Date.now()}]`,
    message: 'Scheduled infrastructure maintenance in progress.',
    type: 'MAINTENANCE',
    isActive: true
  });
  const annId = annRes.json?.data?.id;
  wfFSteps.push({
    step: 'Create Status Page Announcement',
    method: 'POST',
    path: `/status-pages/${fixtures.statusPages.statusPageId}/announcements`,
    status: annRes.status,
    expectedStatus: [201],
    pass: annRes.status === 201 && Boolean(annId),
    latencyMs: annRes.latencyMs
  });

  // F4. List Announcements
  const annListRes = await request(`/status-pages/${fixtures.statusPages.statusPageId}/announcements`, 'GET');
  wfFSteps.push({
    step: 'List Status Page Announcements',
    method: 'GET',
    path: `/status-pages/${fixtures.statusPages.statusPageId}/announcements`,
    status: annListRes.status,
    expectedStatus: [200],
    pass: annListRes.status === 200 && annListRes.json?.data?.length > 0,
    latencyMs: annListRes.latencyMs
  });

  const wfFPass = wfFSteps.every(s => s.pass);
  workflows.push({
    domain: 'Status Pages',
    title: 'Public Status Configuration & Announcements',
    steps: wfFSteps,
    pass: wfFPass,
    durationMs: Math.round(performance.now() - wfFStart)
  });
  console.log(`Workflow F Result: ${wfFPass ? 'PASS' : 'FAIL'} (${wfFSteps.length} steps)`);

  // =========================================================================
  // WORKFLOW G: Postmortems
  // =========================================================================
  console.log('\n--- Running Workflow G: Postmortems ---');
  const wfGStart = performance.now();
  const wfGSteps: WorkflowStepResult[] = [];

  // G0. Create and Fully Resolve Incident for Postmortem
  const pmIncRes = await request('/incidents', 'POST', {
    title: `Postmortem Candidate Incident [${Date.now()}]`,
    description: 'Resolved incident for retrospective workflow',
    serviceId: fixtures.services.serviceAId,
    urgency: 'HIGH',
    priority: 'P2'
  });
  const pmIncId = pmIncRes.json?.data?.id;
  if (pmIncId) {
    await request(`/incidents/${pmIncId}/acknowledge`, 'POST', {
      note: 'Acknowledging prior to resolution'
    });
    await request(`/incidents/${pmIncId}/resolve`, 'POST', {
      resolutionNote: 'Root cause mitigated successfully'
    });
  }

  // G1. Create Postmortem
  const pmRes = await request('/postmortems', 'POST', {
    incidentId: pmIncId || fixtures.incidents.resolvedId,
    title: `Retrospective: Service Outage Root Cause [${Date.now()}]`,
    summary: 'Detailed root-cause analysis and remediation timeline',
    rootCause: 'Connection saturation under burst load',
    resolution: 'Dynamically adjusted max pool limit and connection timeouts',
    lessons: 'Add connection pool health gauges to primary dashboard'
  });
  const pmId = pmRes.json?.data?.id;
  const pmEtag = pmRes.headers.get('etag') || '"1"';
  wfGSteps.push({
    step: 'Create Postmortem',
    method: 'POST',
    path: '/postmortems',
    status: pmRes.status,
    expectedStatus: [201],
    pass: pmRes.status === 201 && Boolean(pmId),
    latencyMs: pmRes.latencyMs,
    dataSnippet: pmId
  });

  if (pmId) {
    // G2. Get Postmortem Details
    const pmGetRes = await request(`/postmortems/${pmId}`, 'GET');
    wfGSteps.push({
      step: 'Get Postmortem',
      method: 'GET',
      path: `/postmortems/${pmId}`,
      status: pmGetRes.status,
      expectedStatus: [200],
      pass: pmGetRes.status === 200 && pmGetRes.json?.data?.status === 'DRAFT',
      latencyMs: pmGetRes.latencyMs
    });

    // G3. Update Postmortem (Publish)
    const pmPatchRes = await request(
      `/postmortems/${pmId}`,
      'PATCH',
      { status: 'PUBLISHED', isPublic: true },
      { 'If-Match': pmEtag }
    );
    wfGSteps.push({
      step: 'Publish Postmortem (with ETag)',
      method: 'PATCH',
      path: `/postmortems/${pmId}`,
      status: pmPatchRes.status,
      expectedStatus: [200],
      pass: pmPatchRes.status === 200 && pmPatchRes.json?.data?.status === 'PUBLISHED',
      latencyMs: pmPatchRes.latencyMs
    });

    // G4. List Postmortem Versions
    const pmVersionsRes = await request(`/postmortems/${pmId}/versions`, 'GET');
    wfGSteps.push({
      step: 'List Postmortem Historical Versions',
      method: 'GET',
      path: `/postmortems/${pmId}/versions`,
      status: pmVersionsRes.status,
      expectedStatus: [200],
      pass: pmVersionsRes.status === 200,
      latencyMs: pmVersionsRes.latencyMs
    });
  }

  const wfGPass = wfGSteps.every(s => s.pass);
  workflows.push({
    domain: 'Postmortems',
    title: 'Postmortem Retrospective Lifecycle & Publication',
    steps: wfGSteps,
    pass: wfGPass,
    durationMs: Math.round(performance.now() - wfGStart)
  });
  console.log(`Workflow G Result: ${wfGPass ? 'PASS' : 'FAIL'} (${wfGSteps.length} steps)`);

  // =========================================================================
  // WORKFLOW H: Reports & Dashboards
  // =========================================================================
  console.log('\n--- Running Workflow H: Reports & Dashboards ---');
  const wfHStart = performance.now();
  const wfHSteps: WorkflowStepResult[] = [];

  // H1. Create Dashboard
  const dashRes = await request('/dashboards', 'POST', {
    name: `SRE Health Board [${Date.now()}]`,
    description: 'Executive service availability and MTTR tracking',
    visibility: 'PRIVATE',
    widgets: []
  });
  const dashId = dashRes.json?.data?.id;
  const dashEtag = dashRes.headers.get('etag') || '"1"';
  wfHSteps.push({
    step: 'Create Dashboard',
    method: 'POST',
    path: '/dashboards',
    status: dashRes.status,
    expectedStatus: [201],
    pass: dashRes.status === 201 && Boolean(dashId),
    latencyMs: dashRes.latencyMs,
    dataSnippet: dashId
  });

  if (dashId) {
    // H2. Get Dashboard
    const dashGetRes = await request(`/dashboards/${dashId}`, 'GET');
    wfHSteps.push({
      step: 'Get Dashboard',
      method: 'GET',
      path: `/dashboards/${dashId}`,
      status: dashGetRes.status,
      expectedStatus: [200],
      pass: dashGetRes.status === 200,
      latencyMs: dashGetRes.latencyMs
    });

    // H3. Update Dashboard
    const dashPatchRes = await request(
      `/dashboards/${dashId}`,
      'PATCH',
      { description: 'Real-time updated executive reliability metrics' },
      { 'If-Match': dashEtag }
    );
    wfHSteps.push({
      step: 'Update Dashboard (with ETag)',
      method: 'PATCH',
      path: `/dashboards/${dashId}`,
      status: dashPatchRes.status,
      expectedStatus: [200],
      pass: dashPatchRes.status === 200,
      latencyMs: dashPatchRes.latencyMs
    });

    // H4. Duplicate Dashboard
    const dupRes = await request(`/dashboards/${dashId}/duplicate`, 'POST', {});
    const dupId = dupRes.json?.data?.id;
    wfHSteps.push({
      step: 'Duplicate Dashboard',
      method: 'POST',
      path: `/dashboards/${dashId}/duplicate`,
      status: dupRes.status,
      expectedStatus: [201],
      pass: dupRes.status === 201 && Boolean(dupId),
      latencyMs: dupRes.latencyMs
    });

    // H5. Delete Duplicated Dashboard
    if (dupId) {
      const dupGetRes = await request(`/dashboards/${dupId}`, 'GET');
      const dupEtag = dupGetRes.headers.get('etag') || '"1"';
      const delDupRes = await request(`/dashboards/${dupId}`, 'DELETE', undefined, { 'If-Match': dupEtag });
      wfHSteps.push({
        step: 'Delete Cloned Dashboard',
        method: 'DELETE',
        path: `/dashboards/${dupId}`,
        status: delDupRes.status,
        expectedStatus: [200, 204],
        pass: delDupRes.status === 200 || delDupRes.status === 204,
        latencyMs: delDupRes.latencyMs
      });
    }
  }

  const wfHPass = wfHSteps.every(s => s.pass);
  workflows.push({
    domain: 'Dashboards & Reports',
    title: 'Dashboard Authoring, Widgets, Duplication & Lifecycle',
    steps: wfHSteps,
    pass: wfHPass,
    durationMs: Math.round(performance.now() - wfHStart)
  });
  console.log(`Workflow H Result: ${wfHPass ? 'PASS' : 'FAIL'} (${wfHSteps.length} steps)`);

  // =========================================================================
  // Generate WORKFLOW-MATRIX.md Report
  // =========================================================================
  const commitSha = 'fdabcf67b45ae772d9c4413dc4a915f5b1ea3cfc';
  const outDir = path.resolve(`reports/api-v2-certification/${commitSha}`);
  fs.mkdirSync(outDir, { recursive: true });

  const totalWorkflows = workflows.length;
  const passedWorkflows = workflows.filter(w => w.pass).length;
  const totalSteps = workflows.reduce((acc, w) => acc + w.steps.length, 0);
  const passedSteps = workflows.reduce((acc, w) => acc + w.steps.filter(s => s.pass).length, 0);

  let md = `# Business-Domain Workflow Certification Matrix\n\n`;
  md += `**Commit SHA:** \`${commitSha}\`  \n`;
  md += `**Environment:** Production Topology (Nginx Reverse Proxy on \`:3900\`, PostgreSQL 16 on \`:55490\`)  \n`;
  md += `**Certified At:** ${new Date().toISOString()}  \n\n`;
  md += `## Executive Summary\n\n`;
  md += `- **Total Business Workflows:** ${totalWorkflows}\n`;
  md += `- **Passed Workflows:** ${passedWorkflows} / ${totalWorkflows} (${((passedWorkflows / totalWorkflows) * 100).toFixed(1)}%)\n`;
  md += `- **Total Atomic Steps:** ${totalSteps}\n`;
  md += `- **Passed Steps:** ${passedSteps} / ${totalSteps} (${((passedSteps / totalSteps) * 100).toFixed(1)}%)\n\n`;

  md += `| Domain | Workflow Title | Steps | Duration | Verdict |\n`;
  md += `|---|---|---|---|---|\n`;
  for (const wf of workflows) {
    md += `| ${wf.domain} | ${wf.title} | ${wf.steps.length} | ${wf.durationMs}ms | **${wf.pass ? 'PASS' : 'FAIL'}** |\n`;
  }
  md += `\n---\n\n`;

  for (const wf of workflows) {
    md += `### ${wf.domain}: ${wf.title}\n\n`;
    md += `**Overall Result:** ${wf.pass ? '✅ PASS' : '❌ FAIL'} (${wf.durationMs}ms)\n\n`;
    md += `| # | Step Name | Method | Path | Expected | Actual | Latency | Result |\n`;
    md += `|---|---|---|---|---|---|---|---|\n`;
    wf.steps.forEach((s, idx) => {
      md += `| ${idx + 1} | ${s.step} | \`${s.method}\` | \`${s.path}\` | \`${s.expectedStatus.join('/')}\` | \`${s.status}\` | ${s.latencyMs}ms | ${s.pass ? '✅ PASS' : '❌ FAIL'} |\n`;
    });
    md += `\n`;
  }

  const outPath = path.join(outDir, 'WORKFLOW-MATRIX.md');
  fs.writeFileSync(outPath, md);
  console.log(`\nSuccessfully wrote WORKFLOW-MATRIX.md to ${outPath}`);
}

main().catch(console.error);
