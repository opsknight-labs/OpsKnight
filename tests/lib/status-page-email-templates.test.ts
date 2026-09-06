import { describe, it, expect } from 'vitest';
import {
  getIncidentCreatedTemplate,
  getIncidentResolvedTemplate,
  getStatusChangeTemplate,
  EmailTemplateData,
} from '@/lib/status-page-email-templates';

describe('Status Page Email Templates', () => {
  const baseData: EmailTemplateData = {
    statusPageName: 'Test Status Page',
    statusPageUrl: 'https://status.example.com',
    unsubscribeUrl: 'https://status.example.com/unsubscribe/token123',
  };

  describe('getIncidentCreatedTemplate', () => {
    it('should generate incident created email with all fields', () => {
      const data: EmailTemplateData = {
        ...baseData,
        incidentTitle: 'Service Outage',
        incidentDescription: 'We are experiencing issues with our API',
        affectedServices: ['API Service', 'Database Service'],
        incidentUrl: 'https://status.example.com/incidents/123',
      };

      const result = getIncidentCreatedTemplate(data);

      expect(result.subject).toBe('[Test Status Page] 🚨 Incident: Service Outage');
      expect(result.html).toContain('Test Status Page');
      expect(result.html).toContain('Service Outage');
      expect(result.html).toContain('We are experiencing issues with our API');
      expect(result.html).toContain('API Service');
      expect(result.html).toContain('Database Service');
      expect(result.html).toContain('https://status.example.com/incidents/123');
      expect(result.html).toContain('unsubscribe/token123');

      expect(result.text).toContain('Test Status Page');
      expect(result.text).toContain('Service Outage');
      expect(result.text).toContain('API Service');
      expect(result.text).toContain('Database Service');
    });

    it('should handle missing optional fields', () => {
      const result = getIncidentCreatedTemplate(baseData);

      expect(result.subject).toBe('[Test Status Page] 🚨 Incident: New Incident');
      expect(result.html).toContain('New Incident');
      expect(result.html).not.toContain('Affected Services');
      expect(result.text).toContain('New Incident');
    });

    it('should include unsubscribe link when provided', () => {
      const result = getIncidentCreatedTemplate(baseData);

      expect(result.html).toContain('unsubscribe/token123');
      expect(result.text).toContain('unsubscribe/token123');
    });

    it('should handle missing unsubscribe URL', () => {
      const data = {
        ...baseData,
        unsubscribeUrl: undefined,
      };

      const result = getIncidentCreatedTemplate(data);

      expect(result.html).not.toContain('unsubscribe');
      expect(result.text).not.toContain('Unsubscribe:');
    });

    it('should use status page URL as fallback for incident URL', () => {
      const data = {
        ...baseData,
        incidentTitle: 'Test Incident',
      };

      const result = getIncidentCreatedTemplate(data);

      expect(result.html).toContain('href="https://status.example.com"');
      expect(result.text).toContain('https://status.example.com');
    });
  });

  describe('getIncidentResolvedTemplate', () => {
    it('should generate resolved email with all fields', () => {
      const data: EmailTemplateData = {
        ...baseData,
        incidentTitle: 'Service Outage',
        incidentDescription: 'Issue has been resolved',
        incidentUrl: 'https://status.example.com/incidents/123',
      };

      const result = getIncidentResolvedTemplate(data);

      expect(result.subject).toBe('[Test Status Page] ✅ Resolved: Service Outage');
      expect(result.html).toContain('Incident Resolved');
      expect(result.html).toContain('Service Outage');
      expect(result.html).toContain('Issue has been resolved');
      expect(result.html).toContain('https://status.example.com');
      expect(result.html).toContain('unsubscribe/token123');

      expect(result.text).toContain('Service Outage has been resolved');
      expect(result.text).toContain('Issue has been resolved');
    });

    it('should handle missing optional fields', () => {
      const result = getIncidentResolvedTemplate(baseData);

      expect(result.subject).toBe('[Test Status Page] ✅ Resolved: Incident');
      expect(result.html).toContain('Incident');
      expect(result.text).toContain('Incident has been resolved');
    });

    it('should use status page URL as fallback for incident URL', () => {
      const data = {
        ...baseData,
        incidentTitle: 'Test Incident',
      };

      const result = getIncidentResolvedTemplate(data);

      expect(result.html).toContain('href="https://status.example.com"');
      expect(result.text).toContain('https://status.example.com');
    });
  });

  describe('getStatusChangeTemplate', () => {
    it('should generate status change email with all fields', () => {
      const data: EmailTemplateData = {
        ...baseData,
        incidentStatus: 'Investigating',
        incidentDescription: 'We are currently investigating the issue',
      };

      const result = getStatusChangeTemplate(data);

      expect(result.subject).toBe('[Test Status Page] 🔄 Status Update');
      expect(result.html).toContain('Status Update');
      expect(result.html).toContain('Investigating');
      expect(result.html).toContain('We are currently investigating the issue');
      expect(result.html).toContain('unsubscribe/token123');

      expect(result.text).toContain('Status: Investigating');
      expect(result.text).toContain('We are currently investigating the issue');
    });

    it('should handle missing optional fields', () => {
      const result = getStatusChangeTemplate(baseData);

      expect(result.html).toContain('Status Update');
      expect(result.html).toContain('Updated');
      expect(result.text).toContain('Status: Updated');
    });

    it('should include unsubscribe link when provided', () => {
      const result = getStatusChangeTemplate(baseData);

      expect(result.html).toContain('unsubscribe/token123');
      expect(result.text).toContain('unsubscribe/token123');
    });
  });

  describe('Email template formatting', () => {
    it('should escape HTML in user content', () => {
      const data: EmailTemplateData = {
        ...baseData,
        incidentTitle: '<script>alert("xss")</script>',
        incidentDescription: '<img src=x onerror=alert(1)>',
      };

      const result = getIncidentCreatedTemplate(data);

      expect(result.html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
      expect(result.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
      expect(result.text).toContain(data.incidentTitle);
      expect(result.text).toContain(data.incidentDescription);
    });

    it('should handle long content gracefully', () => {
      const longDescription = 'A'.repeat(1000);
      const data: EmailTemplateData = {
        ...baseData,
        incidentTitle: 'Test',
        incidentDescription: longDescription,
      };

      const result = getIncidentCreatedTemplate(data);

      expect(result.html).toContain(longDescription);
      expect(result.text).toContain(longDescription);
    });

    it('should handle special characters in content', () => {
      const data: EmailTemplateData = {
        ...baseData,
        incidentTitle: 'Service: "Critical" Issue (2024)',
        incidentDescription: "We're experiencing issues with the API.",
      };

      const result = getIncidentCreatedTemplate(data);

      expect(result.html).toContain('Service: &quot;Critical&quot; Issue (2024)');
      expect(result.text).toContain('Service: "Critical" Issue (2024)');
    });
  });
});
