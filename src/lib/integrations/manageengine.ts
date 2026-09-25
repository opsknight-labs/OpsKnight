import { normalizeEventAction, normalizeSeverity } from './normalization';
import type { ManageEnginePayload } from './schemas';

export type ManageEngineEvent = ManageEnginePayload;

type Severity = 'critical' | 'error' | 'warning' | 'info';
type EventAction = 'trigger' | 'resolve' | 'acknowledge';

function severityRank(sev: Severity): number {
  switch (sev) {
    case 'critical':
      return 3;
    case 'error':
      return 2;
    case 'warning':
      return 1;
    case 'info':
      return 0;
  }
}

function maxSeverity(a: Severity, b: Severity): Severity {
  return severityRank(b) > severityRank(a) ? b : a;
}

function sanitizeKey(val: string): string {
  return val
    .trim()
    .slice(0, 250)
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._:-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 120);
}

/**
 * Repairs unescaped control characters (newlines, carriage returns, tabs) inside
 * JSON string literals and trailing commas before closing braces/brackets.
 * ManageEngine OpManager performs raw string substitution for "$message" in
 * webhook templates, which can inject literal newlines from SNMP traps or
 * Windows Event Logs.
 */
function repairMalformedManageEngineJson(raw: string): string {
  let inString = false;
  let escaped = false;
  let out = '';

  for (const ch of raw) {
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString) {
      if (ch === '\n') {
        out += '\\n';
        continue;
      }
      if (ch === '\r') {
        out += '\\r';
        continue;
      }
      if (ch === '\t') {
        out += '\\t';
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code >= 0 && code < 0x20) {
        out += ' ';
        continue;
      }
    }
    out += ch;
  }

  return out.replace(/,(\s*[}\]])/g, '$1');
}

function unwrapEnvelope(obj: Record<string, unknown>): Record<string, unknown> {
  const envelopeKeys = ['alarm', 'alert', 'request', 'event', 'data', 'incident'];
  for (const key of envelopeKeys) {
    // eslint-disable-next-line security/detect-object-injection
    const nested = obj[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const rest = { ...obj };
      // eslint-disable-next-line security/detect-object-injection
      delete rest[key];
      return { ...(nested as Record<string, unknown>), ...rest };
    }
  }
  return obj;
}

/**
 * Parses ManageEngine webhook payloads across all transport formats:
 * 1. Standard JSON objects or single-element arrays
 * 2. Raw OpManager JSON templates containing unescaped newlines/tabs in "$message" or trailing commas
 * 3. Form-UrlEncoded payloads (OpManager "Form Data" mode and ServiceDesk Plus "input_data" parameters)
 */
export function parseManageEnginePayload(rawBody: string): ManageEnginePayload {
  const trimmed = rawBody.trim();
  if (!trimmed) {
    throw new Error('Empty request body');
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      parsed = JSON.parse(repairMalformedManageEngineJson(trimmed));
    }

    if (Array.isArray(parsed)) {
      if (parsed.length > 0 && parsed[0] && typeof parsed[0] === 'object') {
        return unwrapEnvelope(parsed[0] as Record<string, unknown>) as ManageEnginePayload;
      }
      throw new Error('Invalid JSON array payload');
    }

    if (parsed && typeof parsed === 'object') {
      return unwrapEnvelope(parsed as Record<string, unknown>) as ManageEnginePayload;
    }
    throw new Error('Invalid JSON payload');
  }

  // Handle application/x-www-form-urlencoded (OpManager Form Data & ServiceDesk Plus input_data)
  if (trimmed.includes('=')) {
    const params = new URLSearchParams(trimmed);
    const entries: Record<string, unknown> = Object.fromEntries(params.entries());

    for (const jsonField of ['input_data', 'payload', 'data']) {
      // eslint-disable-next-line security/detect-object-injection
      const rawJsonField = entries[jsonField];
      if (typeof rawJsonField === 'string' && rawJsonField.trim().startsWith('{')) {
        try {
          const inner = JSON.parse(repairMalformedManageEngineJson(rawJsonField.trim()));
          if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
            const unwrapped = unwrapEnvelope(inner as Record<string, unknown>);
            return { ...entries, ...unwrapped } as ManageEnginePayload;
          }
        } catch {
          // Keep flat form entries if inner JSON parsing fails
        }
      }
    }

    return unwrapEnvelope(entries) as ManageEnginePayload;
  }

  throw new Error('Invalid JSON in request body');
}

function isUnexpandedManageEngineMacro(trimmed: string): boolean {
  if (!trimmed.startsWith('$') || trimmed.length < 2 || trimmed.includes(' ')) {
    return false;
  }
  const openParen = trimmed.indexOf('(');
  if (openParen === -1) {
    return /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed);
  }
  if (!trimmed.endsWith(')')) {
    return false;
  }
  const prefix = trimmed.slice(0, openParen);
  const inner = trimmed.slice(openParen + 1, -1);
  return /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(prefix) && !inner.includes('(') && !inner.includes(')');
}

/**
 * Strips unexpanded ManageEngine webhook template macros such as "$alarmid",
 * "$stringseverity", or "$DeviceField(ipAddress)" and extracts human-readable
 * strings from ServiceDesk Plus / OpManager nested objects ({ id, name, label }).
 */
function cleanManageEngineValue(value: unknown): string | undefined {
  if (value === null || value === undefined || typeof value === 'boolean') return undefined;

  if (typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    return firstManageEngineString(obj.name, obj.label, obj.value, obj.id);
  }

  if (typeof value !== 'string' && typeof value !== 'number') return undefined;

  const trimmed = String(value).trim();
  if (!trimmed) return undefined;

  if (isUnexpandedManageEngineMacro(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function firstManageEngineString(...values: unknown[]): string | undefined {
  for (const val of values) {
    const cleaned = cleanManageEngineValue(val);
    if (cleaned !== undefined) return cleaned;
  }
  return undefined;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .trim()
    .split(/[\s_\-.:,;/|()[\]]+/)
    .filter(Boolean);
}

function hasAnyToken(tokens: string[], targets: string[]): boolean {
  return targets.some(t => tokens.includes(t));
}

function mapSingleManageEngineSeverityToken(rawValue?: string): Severity | undefined {
  if (!rawValue) return undefined;
  const normalized = rawValue.trim().toLowerCase();
  if (!normalized) return undefined;

  // ManageEngine OpManager numeric severity codes:
  // 1 = Critical, 2 = Trouble, 3 = Attention, 4 = Service Down, 5 = Clear, 6 = Info, 0 = Normal/Clear
  if (normalized === '1' || normalized === '4') return 'critical';
  if (normalized === '2') return 'error';
  if (normalized === '3') return 'warning';
  if (normalized === '5' || normalized === '6' || normalized === '0') return 'info';

  // High-Medium / Low-Medium compound urgency/priority checks before single-token checks
  if (normalized.includes('high-medium') || normalized.includes('high_medium')) {
    return 'error';
  }
  if (normalized.includes('low-medium') || normalized.includes('low_medium')) {
    return 'warning';
  }

  const tokens = tokenize(normalized);

  // Critical / High Urgency (OpManager Critical, Service Down, Device Down, SDP Urgent/High/P1)
  if (
    hasAnyToken(tokens, [
      'critical',
      'crit',
      'servicedown',
      'devicedown',
      'down',
      'urgent',
      'high',
      'immediate',
      'emergency',
      'disaster',
      'fatal',
      'outage',
      'unavailable',
      'unreachable',
      'p1',
      'sev0',
      'sev1',
    ])
  ) {
    return 'critical';
  }

  // Trouble / Major / Error (OpManager Trouble, SDP Major/P2)
  if (hasAnyToken(tokens, ['trouble', 'major', 'error', 'err', 'unhealthy', 'p2', 'sev2'])) {
    return 'error';
  }

  // Attention / Warning / Medium / Moderate / Minor (OpManager Attention, Applications Manager Warning, SDP Medium/P3)
  if (
    hasAnyToken(tokens, [
      'attention',
      'minor',
      'warning',
      'warn',
      'medium',
      'moderate',
      'degraded',
      'abnormal',
      'anomalous',
      'p3',
      'sev3',
    ])
  ) {
    return 'warning';
  }

  // Clear / Info / Normal / Low / Up (OpManager Clear/Info, Applications Manager Up/Healthy, SDP Low/P4/P5)
  if (
    hasAnyToken(tokens, [
      'clear',
      'cleared',
      'normal',
      'information',
      'informational',
      'info',
      'low',
      'ok',
      'up',
      'healthy',
      'available',
      'trivial',
      'resolved',
      'p4',
      'p5',
      'sev4',
      'sev5',
    ])
  ) {
    return 'info';
  }

  return undefined;
}

export function resolveManageEngineSeverity(
  data: ManageEnginePayload,
  action?: EventAction
): Severity {
  if (action === 'resolve') {
    return 'info';
  }

  // 1. Explicit string severity (OpManager $stringseverity)
  const explicitStringSev = mapSingleManageEngineSeverityToken(
    firstManageEngineString(
      data.stringseverity,
      data.stringSeverity,
      data.string_severity,
      data.String_Severity
    )
  );
  if (explicitStringSev && explicitStringSev !== 'info') {
    return explicitStringSev;
  }

  // 2. Explicit urgency / priority / level (ServiceDesk Plus / ITSM / Custom)
  const explicitUrgency = mapSingleManageEngineSeverityToken(
    firstManageEngineString(data.urgency, data.Urgency)
  );
  const explicitPriority = mapSingleManageEngineSeverityToken(
    firstManageEngineString(data.priority, data.Priority, data.level, data.Level)
  );
  if (explicitUrgency && explicitPriority) {
    return maxSeverity(explicitUrgency, explicitPriority);
  }
  if (explicitUrgency && explicitUrgency !== 'info') return explicitUrgency;
  if (explicitPriority && explicitPriority !== 'info') return explicitPriority;

  // 3. Raw severity (OpManager $severity numeric 1..6 or string)
  const rawSev = mapSingleManageEngineSeverityToken(
    firstManageEngineString(data.severity, data.Severity, data.severity_id, data.severityId)
  );
  if (rawSev && rawSev !== 'info') {
    return rawSev;
  }

  // 4. Applications Manager / Site24x7 dual health + availability + status evaluation:
  // A monitor may report availability="Up" (info) while health="Critical" (critical),
  // or availability="Down" (critical) while health="Clear" (info). Take the highest severity.
  const healthSev = mapSingleManageEngineSeverityToken(
    firstManageEngineString(data.health, data.healthStatus)
  );
  const availSev = mapSingleManageEngineSeverityToken(
    firstManageEngineString(data.availability, data.availabilityStatus)
  );
  const statusSev = mapSingleManageEngineSeverityToken(
    firstManageEngineString(
      data.STATUS,
      data.status,
      data.Status,
      data.event_status,
      data.eventStatus,
      data.state
    )
  );

  const combinedStatusSeverities = [healthSev, availSev, statusSev].filter(
    (s): s is Severity => s !== undefined
  );
  if (combinedStatusSeverities.length > 0) {
    return combinedStatusSeverities.reduce((acc, curr) => maxSeverity(acc, curr), 'info');
  }

  // 5. If any explicit field resolved to 'info' (e.g. Low urgency or Informational event), return 'info'
  if (explicitStringSev || explicitUrgency || explicitPriority || rawSev) {
    return 'info';
  }

  const fallbackCandidate = firstManageEngineString(
    data.stringseverity,
    data.urgency,
    data.priority,
    data.severity,
    data.health,
    data.availability,
    data.status,
    data.STATUS
  );
  return normalizeSeverity(fallbackCandidate, 'warning');
}

export function resolveManageEngineAction(data: ManageEnginePayload): EventAction {
  const ackFlag = data.acknowledged ?? data.isAcknowledged;
  if (
    ackFlag === true ||
    ackFlag === 1 ||
    (typeof ackFlag === 'string' &&
      ['true', 'yes', '1', 'acknowledged', 'ack'].includes(ackFlag.trim().toLowerCase()))
  ) {
    return 'acknowledge';
  }

  const explicitAction = firstManageEngineString(data.action, data.Action, data.operation);
  if (explicitAction) {
    const actionTokens = tokenize(explicitAction);
    if (
      hasAnyToken(actionTokens, [
        'unack',
        'unacknowledge',
        'unacknowledged',
        'unassign',
        'reopen',
        'reopened',
      ])
    ) {
      return 'trigger';
    }
    if (
      hasAnyToken(actionTokens, [
        'ack',
        'acknowledge',
        'acknowledged',
        'assign',
        'assigned',
        'pickup',
        'maintenance',
        'downtime',
        'suppress',
        'suppressed',
      ])
    ) {
      return 'acknowledge';
    }
    if (
      hasAnyToken(actionTokens, [
        'clear',
        'cleared',
        'resolve',
        'resolved',
        'recover',
        'recovered',
        'recovery',
        'close',
        'closed',
      ])
    ) {
      return 'resolve';
    }
  }

  const statusText = firstManageEngineString(
    data.STATUS,
    data.status,
    data.Status,
    data.event_status,
    data.eventStatus,
    data.state
  );

  if (statusText) {
    const statusTokens = tokenize(statusText);
    const statusLower = statusText.trim().toLowerCase();
    if (
      !hasAnyToken(statusTokens, ['unack', 'unacknowledge', 'unacknowledged']) &&
      (hasAnyToken(statusTokens, [
        'ack',
        'acknowledge',
        'acknowledged',
        'assigned',
        'maintenance',
        'downtime',
        'suppressed',
      ]) ||
        statusLower === 'in progress' ||
        statusLower === 'in_progress')
    ) {
      return 'acknowledge';
    }
  }

  // Check OpManager stringseverity & numeric severity first
  const stringSev = firstManageEngineString(
    data.stringseverity,
    data.stringSeverity,
    data.string_severity,
    data.String_Severity
  );
  const rawSev = firstManageEngineString(
    data.severity,
    data.Severity,
    data.severity_id,
    data.severityId
  )?.toLowerCase();

  if (stringSev) {
    const sevTokens = tokenize(stringSev);
    if (hasAnyToken(sevTokens, ['clear', 'cleared', 'resolved', 'ok', 'normal', 'up'])) {
      return 'resolve';
    }
    // If stringseverity explicitly indicates an active problem, do not let secondary fields resolve it
    const mappedStringSev = mapSingleManageEngineSeverityToken(stringSev);
    if (mappedStringSev && mappedStringSev !== 'info') {
      return 'trigger';
    }
  }

  const hasExplicitOpenStatus =
    statusText !== undefined &&
    hasAnyToken(tokenize(statusText), ['open', 'active', 'problem', 'firing', 'triggered', 'new']);

  if (!hasExplicitOpenStatus && (rawSev === '5' || rawSev === 'clear' || rawSev === 'cleared')) {
    return 'resolve';
  }
  if (rawSev === '1' || rawSev === '2' || rawSev === '3' || rawSev === '4') {
    return 'trigger';
  }

  // Evaluate Applications Manager / Site24x7 health, availability, and status together:
  // Only resolve if at least one indicator says Clear/Up/Resolved AND no indicator reports an active problem.
  const healthStr = firstManageEngineString(data.health, data.healthStatus);
  const availStr = firstManageEngineString(data.availability, data.availabilityStatus);

  const healthSev = mapSingleManageEngineSeverityToken(healthStr);
  const availSev = mapSingleManageEngineSeverityToken(availStr);
  const statusSev = mapSingleManageEngineSeverityToken(statusText);

  const hasActiveProblem =
    (healthSev !== undefined && healthSev !== 'info') ||
    (availSev !== undefined && availSev !== 'info') ||
    (statusSev !== undefined && statusSev !== 'info');

  if (hasActiveProblem) {
    return 'trigger';
  }

  const combinedResolveCandidates = [statusText, healthStr, availStr].filter((s): s is string =>
    Boolean(s)
  );
  for (const candidate of combinedResolveCandidates) {
    const tokens = tokenize(candidate);
    if (
      hasAnyToken(tokens, [
        'clear',
        'cleared',
        'resolve',
        'resolved',
        'recover',
        'recovered',
        'recovery',
        'ok',
        'up',
        'normal',
        'healthy',
        'available',
        'close',
        'closed',
      ])
    ) {
      return 'resolve';
    }
  }

  return normalizeEventAction(explicitAction || statusText || stringSev, 'trigger');
}

export function transformManageEngineToEvent(data: ManageEnginePayload): {
  event_action: EventAction;
  dedup_key: string;
  payload: {
    summary: string;
    source: string;
    severity: Severity;
    custom_details: Record<string, unknown>;
  };
} {
  const deviceName =
    firstManageEngineString(
      data.displayName,
      data.display_name,
      data.deviceName,
      data.device_name,
      data.Device_Name,
      data.resourcename,
      data.resourceName,
      data.MONITOR_NAME,
      data.MONITORNAME,
      data.monitorname,
      data.monitorName,
      data.monitor_name,
      data.Monitor_Name,
      data.hostName,
      data.host_name,
      data.host,
      data.source,
      data.Source,
      data.ipAddress,
      data.ip_address,
      data.Device_IP,
      data.deviceIp,
      data.device_ip,
      data.hostIp,
      data.host_ip
    ) || 'unknown-device';

  const rawMessage = firstManageEngineString(
    data.message,
    data.Message,
    data.alarmMessage,
    data.alarm_message,
    data.INCIDENT_REASON,
    data.reason,
    data.logMessage,
    data.log_message,
    data.summary,
    data.subject,
    data.description,
    data.Description
  );

  const monitorOrEventType = firstManageEngineString(
    data.attribute,
    data.attributeName,
    data.monitorName,
    data.monitor_name,
    data.Monitor_Name,
    data.monitorname,
    data.MONITOR_NAME,
    data.MONITORNAME,
    data.alertName,
    data.alert_name,
    data.profileName,
    data.profile_name,
    data.ifName,
    data.interfaceName,
    data.interface_name,
    data.eventType,
    data.event_type,
    data.Event_Type,
    data.monitortype,
    data.monitorType,
    data.category,
    data.Category
  );

  const summary = rawMessage
    ? deviceName !== 'unknown-device' &&
      !rawMessage.toLowerCase().includes(deviceName.toLowerCase())
      ? `${deviceName}: ${rawMessage}`
      : rawMessage
    : monitorOrEventType
      ? `${deviceName}: ${monitorOrEventType} Alert`
      : `ManageEngine Alert on ${deviceName}`;

  const eventAction = resolveManageEngineAction(data);
  const severity = resolveManageEngineSeverity(data, eventAction);

  const entity = firstManageEngineString(data.entity, data.Entity);
  const resourceOrMonitorId = firstManageEngineString(
    data.resourceid,
    data.resourceId,
    data.monitorid,
    data.monitorId,
    data.MONITOR_ID,
    data.MONITORID
  );
  const attributeName = firstManageEngineString(data.attribute, data.attributeName);
  const alarmId = firstManageEngineString(
    data.alarmid,
    data.alarmId,
    data.alarm_id,
    data.Alarm_ID,
    data.Alert_ID,
    data.alert_id,
    data.alertId,
    data.eventId,
    data.event_id,
    data.id
  );

  let dedupKey: string;
  if (entity) {
    dedupKey = `manageengine-${sanitizeKey(entity)}`;
  } else if (resourceOrMonitorId) {
    dedupKey = attributeName
      ? `manageengine-${sanitizeKey(resourceOrMonitorId)}-${sanitizeKey(attributeName)}`
      : `manageengine-${sanitizeKey(resourceOrMonitorId)}`;
  } else if (alarmId) {
    dedupKey = `manageengine-${sanitizeKey(deviceName)}-${sanitizeKey(alarmId)}`;
  } else if (monitorOrEventType && monitorOrEventType !== deviceName) {
    dedupKey = `manageengine-${sanitizeKey(deviceName)}-${sanitizeKey(monitorOrEventType)}`;
  } else if (deviceName !== 'unknown-device') {
    dedupKey = `manageengine-${sanitizeKey(deviceName)}`;
  } else {
    dedupKey = `manageengine-unknown-device-${sanitizeKey(summary)}`;
  }

  return {
    event_action: eventAction,
    dedup_key: dedupKey,
    payload: {
      summary,
      source: 'ManageEngine',
      severity,
      custom_details: {
        alarmId,
        entity,
        resourceId: resourceOrMonitorId,
        deviceName: deviceName !== 'unknown-device' ? deviceName : undefined,
        ipAddress: firstManageEngineString(
          data.ipAddress,
          data.ip_address,
          data.Device_IP,
          data.deviceIp,
          data.device_ip,
          data.hostIp,
          data.host_ip
        ),
        stringSeverity: firstManageEngineString(
          data.stringseverity,
          data.stringSeverity,
          data.string_severity,
          data.String_Severity
        ),
        numericSeverity: firstManageEngineString(
          data.severity,
          data.Severity,
          data.severity_id,
          data.severityId
        ),
        urgency: firstManageEngineString(data.urgency, data.Urgency),
        priority: firstManageEngineString(data.priority, data.Priority),
        health: firstManageEngineString(data.health, data.healthStatus),
        availability: firstManageEngineString(data.availability, data.availabilityStatus),
        status: firstManageEngineString(
          data.STATUS,
          data.status,
          data.Status,
          data.event_status,
          data.eventStatus,
          data.state
        ),
        category: firstManageEngineString(
          data.category,
          data.Category,
          data.group,
          data.Group,
          data.groupname,
          data.groupName,
          data.MONITOR_GROUPNAME
        ),
        eventType: firstManageEngineString(
          data.eventType,
          data.event_type,
          data.Event_Type,
          data.monitortype,
          data.monitorType
        ),
        monitorName: firstManageEngineString(
          data.monitorName,
          data.monitor_name,
          data.Monitor_Name,
          data.monitorname,
          data.MONITOR_NAME,
          data.MONITORNAME,
          data.alertName,
          data.alert_name,
          data.profileName,
          data.profile_name
        ),
        attribute: attributeName,
        interfaceName: firstManageEngineString(
          data.ifName,
          data.interfaceName,
          data.interface_name
        ),
        vendor: firstManageEngineString(data.vendor, data.Vendor),
        modifiedTime: firstManageEngineString(
          data.strModTime,
          data.modTime,
          data.mod_time,
          data.INCIDENT_TIME_ISO,
          data.INCIDENT_TIME,
          data.timestamp,
          data.Timestamp,
          data.createdAt,
          data.time
        ),
        alarmUrl: firstManageEngineString(
          data.url,
          data.URL,
          data.alarmUrl,
          data.alarm_url,
          data.eventUrl,
          data.event_url,
          data.webUrl,
          data.RCA_LINK,
          data.rcaUrl,
          data.detailsUrl,
          data.MONITOR_URL
        ),
        acknowledgedBy: firstManageEngineString(
          data.ackUser,
          data.ack_user,
          data.acknowledgedBy,
          data.technician,
          data.owner
        ),
        ackMessage: firstManageEngineString(data.ackMessage, data.ack_message, data.notes),
        raw: data,
      },
    },
  };
}
