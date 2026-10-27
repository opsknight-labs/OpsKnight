// Real provider-shaped trigger requests, reused by the HTTP certification runner.
module.exports = run =>
  [
    [
      'UPTIMEROBOT',
      'uptimerobot',
      { monitorID: run, monitorFriendlyName: 'HTTP monitor', alertType: 1 },
    ],
    ['PINGDOM', 'pingdom', { check_id: run, check_name: 'HTTP check', state: 'down' }],
    [
      'BETTER_UPTIME',
      'better-uptime',
      { incident: { id: run, name: 'HTTP outage', status: 'triggered', severity: 'critical' } },
    ],
    [
      'UPTIME_KUMA',
      'uptime-kuma',
      {
        monitor: { id: run, name: 'HTTP monitor' },
        heartbeat: { monitorID: run, status: 0, msg: 'Down' },
      },
    ],
    [
      'SPLUNK_ONCALL',
      'splunk-oncall',
      { entity_id: run, message: 'HTTP alert', message_type: 'CRITICAL', severity: 'critical' },
    ],
    [
      'SPLUNK_OBSERVABILITY',
      'splunk-observability',
      { incidentId: run, detectorName: 'HTTP detector', status: 'triggered', severity: 'critical' },
    ],
    [
      'DYNATRACE',
      'dynatrace',
      { ProblemID: run, ProblemTitle: 'HTTP problem', State: 'OPEN', SeverityLevel: 'critical' },
    ],
    [
      'APPDYNAMICS',
      'appdynamics',
      { incidentId: run, summary: 'HTTP incident', eventType: 'triggered', severity: 'critical' },
    ],
    [
      'ELASTIC',
      'elastic',
      {
        rule: { id: run, name: 'HTTP rule' },
        alert: { id: run, status: 'active', severity: 'critical' },
      },
    ],
    [
      'HONEYCOMB',
      'honeycomb',
      {
        alert_id: run,
        alert_name: 'HTTP trigger',
        status: 'triggered',
        alert_severity: 'critical',
      },
    ],
    [
      'GOOGLE_CLOUD_MONITORING',
      'google-cloud-monitoring',
      {
        incident: {
          incident_id: run,
          summary: 'HTTP incident',
          state: 'open',
          severity: 'critical',
        },
      },
    ],
    [
      'NAGIOS',
      'nagios',
      {
        hostname: run,
        servicedesc: 'HTTP service',
        notificationtype: 'PROBLEM',
        servicestate: 'CRITICAL',
        serviceoutput: 'HTTP failure',
      },
    ],
    [
      'ICINGA',
      'icinga',
      {
        host_name: run,
        service_name: 'HTTP service',
        notification_type: 'PROBLEM',
        service_state: 'CRITICAL',
        service_output: 'HTTP failure',
      },
    ],
    [
      'ZABBIX',
      'zabbix',
      {
        event_id: run,
        event_name: 'HTTP event',
        event_status: 'PROBLEM',
        event_value: 1,
        event_severity: 'Disaster',
        host_name: 'certifier',
      },
    ],
    [
      'NEWRELIC',
      'newrelic',
      { incident: { id: run, title: 'HTTP incident', state: 'open', severity: 'critical' } },
    ],
    [
      'AZURE',
      'azure',
      {
        schemaId: 'azureMonitorCommonAlertSchema',
        data: {
          essentials: {
            alertId: run,
            alertRule: 'HTTP alert',
            monitorCondition: 'Fired',
            severity: 'Sev0',
          },
        },
      },
    ],
  ].map(([type, route, payload]) => ({ type, route, payload, count: 1 }));
