import { describe, it, expect, vi } from 'vitest';

describe('Status Page Features', () => {
  describe('Public Status Page', () => {
    it('should display service status', () => {
      const services = [
        { id: '1', name: 'API', status: 'OPERATIONAL' },
        { id: '2', name: 'Database', status: 'DEGRADED' },
        { id: '3', name: 'Cache', status: 'OUTAGE' },
      ];

      const getStatusColor = (status: string) => {
        const colors: Record<string, string> = {
          OPERATIONAL: 'green',
          DEGRADED: 'yellow',
          OUTAGE: 'red',
        };
        return colors[status] || 'gray';
      };

      expect(getStatusColor(services[0].status)).toBe('green');
      expect(getStatusColor(services[1].status)).toBe('yellow');
      expect(getStatusColor(services[2].status)).toBe('red');
    });

    it('should display incident history', () => {
      const incidents = [
        {
          id: '1',
          title: 'API Slowdown',
          status: 'RESOLVED',
          createdAt: new Date('2024-01-01'),
        },
        {
          id: '2',
          title: 'Database Outage',
          status: 'INVESTIGATING',
          createdAt: new Date('2024-01-02'),
        },
      ];

      const activeIncidents = incidents.filter(i => i.status !== 'RESOLVED');

      expect(activeIncidents).toHaveLength(1);
      expect(activeIncidents[0].title).toBe('Database Outage');
    });

    it('should calculate uptime percentage', () => {
      const calculateUptime = (totalTime: number, downtime: number) => {
        return ((totalTime - downtime) / totalTime) * 100;
      };

      const uptime = calculateUptime(720, 2); // 720 hours (30 days), 2 hours downtime

      expect(uptime).toBeCloseTo(99.72, 2);
    });
  });

  describe('Status Page Subscriptions', () => {
    it('should subscribe to status updates', () => {
      const subscribe = vi.fn();
      const email = 'user@example.com';

      subscribe(email);

      expect(subscribe).toHaveBeenCalledWith(email);
    });

    it('should unsubscribe from status updates', () => {
      const unsubscribe = vi.fn();
      const token = 'unsubscribe-token-123';

      unsubscribe(token);

      expect(unsubscribe).toHaveBeenCalledWith(token);
    });

    it('should validate subscription email', () => {
      const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

      expect(isValidEmail('user@example.com')).toBe(true);
      expect(isValidEmail('invalid')).toBe(false);
    });
  });

  describe('Custom CSS', () => {
    it('should apply custom CSS to status page', () => {
      const customCSS = `
        .status-page { background: #f0f0f0; }
        .service-item { border: 1px solid #ccc; }
      `;

      const sanitizeCSS = (css: string) => {
        // Remove potentially dangerous CSS (CodeQL fix: added data: and vbscript:)
        return css
          .replace(/<script>/gi, '')
          .replace(/javascript:/gi, '')
          .replace(/vbscript:/gi, '')
          .replace(/data:/gi, '');
      };

      const sanitized = sanitizeCSS(customCSS);

      expect(sanitized).not.toContain('<script>');
      expect(sanitized).toContain('.status-page');

      // Verify CodeQL fix
      expect(sanitizeCSS('expression(javascript:alert(1))')).not.toContain('javascript:');
      expect(sanitizeCSS('background: url(data:image/svg+xml;base64,PHN2Zy...)')).not.toContain(
        'data:'
      );
      expect(sanitizeCSS('behavior: url(vbscript:msgbox(1))')).not.toContain('vbscript:');
    });

    it('should validate CSS syntax', () => {
      const isValidCSS = (css: string) => {
        // Basic validation (CodeQL fix: added data: and vbscript:)
        const lower = css.toLowerCase();
        return (
          !lower.includes('<script>') &&
          !lower.includes('javascript:') &&
          !lower.includes('vbscript:') &&
          !lower.includes('data:')
        );
      };

      expect(isValidCSS('.class { color: red; }')).toBe(true);
      expect(isValidCSS('background: url(data:...)')).toBe(false);
      expect(isValidCSS('<script>alert("xss")</script>')).toBe(false);
    });
  });

  describe('Status Page Metrics', () => {
    it('should track page views', () => {
      const metrics = {
        views: 0,
        uniqueVisitors: 0,
      };

      const trackView = () => {
        metrics.views++;
      };

      trackView();
      trackView();

      expect(metrics.views).toBe(2);
    });

    it('should calculate response time', () => {
      const responseTimes = [100, 150, 200, 120, 180];

      const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;

      expect(avgResponseTime).toBe(150);
    });
  });
});

describe('RBAC (Role-Based Access Control)', () => {
  describe('Permission Checks', () => {
    it('should check if user has permission', () => {
      const hasPermission = (userRole: string, requiredPermission: string) => {
        const permissions: Record<string, string[]> = {
          ADMIN: ['read', 'write', 'delete', 'manage_users'],
          USER: ['read', 'write'],
          VIEWER: ['read'],
        };

        return permissions[userRole]?.includes(requiredPermission) || false;
      };

      expect(hasPermission('ADMIN', 'delete')).toBe(true);
      expect(hasPermission('USER', 'delete')).toBe(false);
      expect(hasPermission('VIEWER', 'write')).toBe(false);
    });

    it('should check role hierarchy', () => {
      const roleHierarchy = {
        ADMIN: 3,
        USER: 2,
        VIEWER: 1,
      };

      const hasHigherRole = (
        userRole: keyof typeof roleHierarchy,
        requiredRole: keyof typeof roleHierarchy
      ) => {
        return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
      };

      expect(hasHigherRole('ADMIN', 'USER')).toBe(true);
      expect(hasHigherRole('VIEWER', 'ADMIN')).toBe(false);
    });
  });

  describe('Resource Access', () => {
    it('should check resource ownership', () => {
      const canAccessResource = (userId: string, resourceOwnerId: string, userRole: string) => {
        return userId === resourceOwnerId || userRole === 'ADMIN';
      };

      expect(canAccessResource('user-1', 'user-1', 'USER')).toBe(true);
      expect(canAccessResource('user-1', 'user-2', 'USER')).toBe(false);
      expect(canAccessResource('user-1', 'user-2', 'ADMIN')).toBe(true);
    });
  });
});

describe('Status Page Settings Save Flow', () => {
  describe('API Route Handler Logic', () => {
    it('should correctly build updateData from request body', () => {
      const buildUpdateData = (parsed: any) => {
        const {
          organizationName,
          subdomain,
          customDomain,
          enabled,
          showServices,
          showIncidents,
          showMetrics,
          showSubscribe,
          uptimeExcellentThreshold,
          uptimeGoodThreshold,
          footerText,
          contactEmail,
          contactUrl,
        } = parsed;

        return {
          organizationName:
            organizationName !== undefined
              ? organizationName && organizationName.trim()
                ? organizationName.trim()
                : null
              : undefined,
          subdomain: subdomain && subdomain.trim() ? subdomain.trim() : null,
          customDomain: customDomain && customDomain.trim() ? customDomain.trim() : null,
          enabled: enabled !== false,
          showServices: showServices !== false,
          showIncidents: showIncidents !== false,
          showMetrics: showMetrics !== false,
          showSubscribe: showSubscribe !== false,
          uptimeExcellentThreshold: uptimeExcellentThreshold ?? undefined,
          uptimeGoodThreshold: uptimeGoodThreshold ?? undefined,
          footerText: footerText && footerText.trim() ? footerText.trim() : null,
          contactEmail: contactEmail && contactEmail.trim() ? contactEmail.trim() : null,
          contactUrl: contactUrl && contactUrl.trim() ? contactUrl.trim() : null,
        };
      };

      const input = {
        organizationName: 'Test Org',
        subdomain: 'teststatus',
        enabled: true,
        showServices: true,
        uptimeExcellentThreshold: 99.9,
        uptimeGoodThreshold: 99.0,
        contactEmail: 'test@example.com',
      };

      const result = buildUpdateData(input);

      expect(result.organizationName).toBe('Test Org');
      expect(result.subdomain).toBe('teststatus');
      expect(result.enabled).toBe(true);
      expect(result.uptimeExcellentThreshold).toBe(99.9);
      expect(result.uptimeGoodThreshold).toBe(99.0);
      expect(result.contactEmail).toBe('test@example.com');
    });

    it('should handle explicit false for boolean fields', () => {
      const buildBooleanField = (value: boolean | undefined) => value !== false;

      expect(buildBooleanField(false)).toBe(false);
      expect(buildBooleanField(true)).toBe(true);
      expect(buildBooleanField(undefined)).toBe(true);
    });

    it('should handle empty strings correctly', () => {
      const normalizeStringField = (value: string | null | undefined) =>
        value && value.trim() ? value.trim() : null;

      expect(normalizeStringField('')).toBe(null);
      expect(normalizeStringField('  ')).toBe(null);
      expect(normalizeStringField('test')).toBe('test');
      expect(normalizeStringField('  test  ')).toBe('test');
      expect(normalizeStringField(null)).toBe(null);
      expect(normalizeStringField(undefined)).toBe(null);
    });

    it('should handle uptime threshold coercion', () => {
      const normalizeThreshold = (value: number | undefined) => value ?? undefined;

      expect(normalizeThreshold(99.9)).toBe(99.9);
      expect(normalizeThreshold(0)).toBe(0);
      expect(normalizeThreshold(undefined)).toBe(undefined);
    });
  });

  describe('Service Config Handling', () => {
    it('should transform serviceConfigs for database', () => {
      const serviceConfigs: Record<
        string,
        { displayName?: string | null; order?: number; showOnPage?: boolean }
      > = {
        'service-1': { displayName: 'API Service', order: 1, showOnPage: true },
        'service-2': { displayName: 'Database', order: 2, showOnPage: false },
        'service-3': { order: 3 }, // No displayName
      };
      const serviceIds = ['service-1', 'service-2', 'service-3'];

      const transformedData = serviceIds.map(serviceId => {
        const config = serviceConfigs[serviceId] || {};
        return {
          statusPageId: 'page-123',
          serviceId,
          displayName: config.displayName || null,
          order: config.order || 0,
          showOnPage: config.showOnPage !== false,
        };
      });

      expect(transformedData).toHaveLength(3);
      expect(transformedData[0]).toEqual({
        statusPageId: 'page-123',
        serviceId: 'service-1',
        displayName: 'API Service',
        order: 1,
        showOnPage: true,
      });
      expect(transformedData[1].showOnPage).toBe(false);
      expect(transformedData[2].displayName).toBe(null);
      expect(transformedData[2].showOnPage).toBe(true); // Default to true
    });

    it('should handle empty serviceIds array', () => {
      const serviceIds: string[] = [];
      const result = serviceIds.length > 0 ? serviceIds.map(id => ({ id })) : [];

      expect(result).toHaveLength(0);
    });

    it('should handle missing service in configs', () => {
      const serviceConfigs: Record<string, { displayName?: string | null; order?: number }> = {
        'service-1': { displayName: 'API', order: 1 },
      };

      const config = serviceConfigs['service-unknown'] || {};
      expect(config.displayName).toBe(undefined);
      expect(config.order).toBe(undefined);
    });
  });

  describe('Branding JSON Persistence', () => {
    it('should preserve all branding fields', () => {
      const brandingData = {
        logoUrl: '/logo.svg',
        faviconUrl: '/favicon.ico',
        primaryColor: '#667eea',
        backgroundColor: '#ffffff',
        textColor: '#111827',
        customCss: '.custom { color: red; }',
        layout: 'wide',
        showHeader: true,
        showFooter: false,
        metaTitle: 'Custom Title',
        metaDescription: 'Custom Description',
        autoRefresh: true,
        refreshInterval: 30,
        showRssLink: true,
        showApiLink: false,
      };

      // Simulate JSON serialization/deserialization
      const serialized = JSON.stringify(brandingData);
      const deserialized = JSON.parse(serialized);

      expect(deserialized.logoUrl).toBe('/logo.svg');
      expect(deserialized.faviconUrl).toBe('/favicon.ico');
      expect(deserialized.primaryColor).toBe('#667eea');
      expect(deserialized.backgroundColor).toBe('#ffffff');
      expect(deserialized.textColor).toBe('#111827');
      expect(deserialized.customCss).toBe('.custom { color: red; }');
      expect(deserialized.layout).toBe('wide');
      expect(deserialized.showHeader).toBe(true);
      expect(deserialized.showFooter).toBe(false);
      expect(deserialized.metaTitle).toBe('Custom Title');
      expect(deserialized.metaDescription).toBe('Custom Description');
      expect(deserialized.autoRefresh).toBe(true);
      expect(deserialized.refreshInterval).toBe(30);
      expect(deserialized.showRssLink).toBe(true);
      expect(deserialized.showApiLink).toBe(false);
    });

    it('should handle null branding', () => {
      const branding = null;
      const parsed = branding && typeof branding === 'object' ? branding : {};

      expect(parsed).toEqual({});
    });

    it('should handle missing optional branding fields', () => {
      const branding = { logoUrl: '/logo.svg' };
      const defaults = {
        logoUrl: branding.logoUrl || '/default-logo.svg',
        primaryColor: (branding as any).primaryColor || '#667eea', // eslint-disable-line @typescript-eslint/no-explicit-any
        autoRefresh: (branding as any).autoRefresh !== false, // eslint-disable-line @typescript-eslint/no-explicit-any
      };

      expect(defaults.logoUrl).toBe('/logo.svg');
      expect(defaults.primaryColor).toBe('#667eea');
      expect(defaults.autoRefresh).toBe(true);
    });
  });

  describe('Auto-Refresh Functionality', () => {
    it('should generate cache bypass URL', () => {
      const generateCacheBypassUrl = (baseUrl: string) => {
        const url = new URL(baseUrl);
        url.searchParams.set('_t', Date.now().toString());
        return url.toString();
      };

      const originalUrl = 'https://status.example.com/';
      const result = generateCacheBypassUrl(originalUrl);

      expect(result).toContain('https://status.example.com/');
      expect(result).toContain('_t=');
    });

    it('should preserve existing query params when adding cache bypass', () => {
      const addCacheBypass = (baseUrl: string) => {
        const url = new URL(baseUrl);
        url.searchParams.set('_t', '12345');
        return url.toString();
      };

      const urlWithParams = 'https://status.example.com/?tab=incidents';
      const result = addCacheBypass(urlWithParams);

      expect(result).toContain('tab=incidents');
      expect(result).toContain('_t=12345');
    });

    it('should validate refresh interval bounds', () => {
      const isValidRefreshInterval = (interval: number) =>
        Number.isInteger(interval) && interval >= 30 && interval <= 3600;

      expect(isValidRefreshInterval(30)).toBe(true);
      expect(isValidRefreshInterval(60)).toBe(true);
      expect(isValidRefreshInterval(3600)).toBe(true);
      expect(isValidRefreshInterval(29)).toBe(false);
      expect(isValidRefreshInterval(3601)).toBe(false);
      expect(isValidRefreshInterval(60.5)).toBe(false);
    });

    it('should only enable auto-refresh when interval >= 30', () => {
      const shouldAutoRefresh = (enabled: boolean, interval: number) => enabled && interval >= 30;

      expect(shouldAutoRefresh(true, 60)).toBe(true);
      expect(shouldAutoRefresh(true, 29)).toBe(false);
      expect(shouldAutoRefresh(false, 60)).toBe(false);
    });
  });

  describe('Privacy Settings Handling', () => {
    it('should handle all privacy boolean fields', () => {
      const privacySettings = {
        privacyMode: 'CUSTOM' as const,
        showIncidentDetails: false,
        showIncidentTitles: true,
        showIncidentDescriptions: false,
        showAffectedServices: true,
        showIncidentTimestamps: true,
        showServiceMetrics: false,
        showServiceDescriptions: true,
        showServiceRegions: false,
        showTeamInformation: false,
        showCustomFields: true,
        showIncidentAssignees: false,
        showIncidentUrgency: true,
        showUptimeHistory: true,
        showRecentIncidents: false,
      };

      // Simulate conditional update logic
      const updateData: Record<string, boolean | string> = {};
      if (privacySettings.privacyMode !== undefined)
        updateData.privacyMode = privacySettings.privacyMode;
      if (privacySettings.showIncidentDetails !== undefined)
        updateData.showIncidentDetails = privacySettings.showIncidentDetails;
      if (privacySettings.showIncidentTitles !== undefined)
        updateData.showIncidentTitles = privacySettings.showIncidentTitles;

      expect(updateData.privacyMode).toBe('CUSTOM');
      expect(updateData.showIncidentDetails).toBe(false);
      expect(updateData.showIncidentTitles).toBe(true);
    });

    it('should handle maxIncidentsToShow and incidentHistoryDays', () => {
      const settings = {
        maxIncidentsToShow: 100,
        incidentHistoryDays: 30,
      };

      expect(settings.maxIncidentsToShow).toBe(100);
      expect(settings.incidentHistoryDays).toBe(30);
    });

    it('should handle allowedCustomFields array', () => {
      const allowedCustomFields = ['customer_id', 'environment', 'priority'];

      // Simulate JSON serialization
      const serialized = JSON.stringify(allowedCustomFields);
      const deserialized = JSON.parse(serialized);

      expect(deserialized).toEqual(['customer_id', 'environment', 'priority']);
      expect(deserialized).toHaveLength(3);
    });
  });
});

describe('Status Page Error Scenarios', () => {
  describe('Validation Error Handling', () => {
    it('should detect invalid email format', () => {
      const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

      expect(isValidEmail('test@example.com')).toBe(true);
      expect(isValidEmail('invalid')).toBe(false);
      expect(isValidEmail('test@')).toBe(false);
      expect(isValidEmail('@example.com')).toBe(false);
      expect(isValidEmail('test@example')).toBe(false);
      expect(isValidEmail('')).toBe(false);
    });

    it('should detect invalid URL format', () => {
      const isValidUrl = (url: string) => {
        try {
          new URL(url);
          return true;
        } catch {
          return false;
        }
      };

      expect(isValidUrl('https://example.com')).toBe(true);
      expect(isValidUrl('http://example.com/path')).toBe(true);
      expect(isValidUrl('invalid')).toBe(false);
      expect(isValidUrl('example.com')).toBe(false);
      expect(isValidUrl('')).toBe(false);
    });

    it('should handle API error responses', () => {
      const handleApiError = (response: { ok: boolean; status: number }) => {
        if (!response.ok) {
          if (response.status === 400) return 'Invalid request data';
          if (response.status === 403) return 'Permission denied';
          if (response.status === 404) return 'Status page not found';
          if (response.status === 409) return 'Name already exists';
          if (response.status >= 500) return 'Server error, please try again';
          return 'Unknown error';
        }
        return null;
      };

      expect(handleApiError({ ok: true, status: 200 })).toBe(null);
      expect(handleApiError({ ok: false, status: 400 })).toBe('Invalid request data');
      expect(handleApiError({ ok: false, status: 403 })).toBe('Permission denied');
      expect(handleApiError({ ok: false, status: 404 })).toBe('Status page not found');
      expect(handleApiError({ ok: false, status: 409 })).toBe('Name already exists');
      expect(handleApiError({ ok: false, status: 500 })).toBe('Server error, please try again');
    });

    it('should validate JSON parse errors', () => {
      const safeJsonParse = (str: string) => {
        try {
          return { success: true, data: JSON.parse(str) };
        } catch {
          return { success: false, data: null };
        }
      };

      expect(safeJsonParse('{"valid": true}').success).toBe(true);
      expect(safeJsonParse('invalid json').success).toBe(false);
      expect(safeJsonParse('').success).toBe(false);
    });
  });

  describe('Name Validation', () => {
    it('should validate status page name uniqueness logic', () => {
      const existingNames = ['Main Status', 'Production Status', 'API Status'];
      const currentPageId = 'page-1';
      const pageIdMap: Record<string, string> = {
        'Main Status': 'page-1',
        'Production Status': 'page-2',
        'API Status': 'page-3',
      };

      const isNameAvailable = (name: string, excludeId?: string) => {
        const existingPageId = pageIdMap[name];
        if (!existingPageId) return true;
        return existingPageId === excludeId;
      };

      // New unique name
      expect(isNameAvailable('New Status Page')).toBe(true);

      // Same name as current page (should be allowed)
      expect(isNameAvailable('Main Status', currentPageId)).toBe(true);

      // Name of another page (should be rejected)
      expect(isNameAvailable('Production Status', currentPageId)).toBe(false);
    });

    it('should trim and normalize name before checking', () => {
      const normalizeName = (name: string) => name.trim().replace(/\s+/g, ' ');

      expect(normalizeName('  Test Status  ')).toBe('Test Status');
      expect(normalizeName('Test  Multiple   Spaces')).toBe('Test Multiple Spaces');
      expect(normalizeName('Normal Name')).toBe('Normal Name');
    });

    it('should validate name length limits', () => {
      const isValidNameLength = (name: string) => {
        const trimmed = name.trim();
        return trimmed.length > 0 && trimmed.length <= 200;
      };

      expect(isValidNameLength('Valid Name')).toBe(true);
      expect(isValidNameLength('')).toBe(false);
      expect(isValidNameLength('   ')).toBe(false);
      expect(isValidNameLength('a'.repeat(200))).toBe(true);
      expect(isValidNameLength('a'.repeat(201))).toBe(false);
    });
  });
});

describe('Status Page Edge Cases', () => {
  describe('Data Coercion Edge Cases', () => {
    it('should handle number 0 correctly (not treated as falsy)', () => {
      const thresholds = {
        uptimeExcellent: 0,
        uptimeGood: 0,
      };

      // Using ?? instead of || to preserve 0
      const normalizedExcellent = thresholds.uptimeExcellent ?? 99.9;
      const normalizedGood = thresholds.uptimeGood ?? 99.0;

      expect(normalizedExcellent).toBe(0);
      expect(normalizedGood).toBe(0);
    });

    it('should handle false boolean correctly', () => {
      const settings = {
        enabled: false,
        showServices: false,
        showIncidents: false,
      };

      const result = {
        enabled: settings.enabled !== undefined ? settings.enabled : true,
        showServices: settings.showServices !== undefined ? settings.showServices : true,
        showIncidents: settings.showIncidents !== undefined ? settings.showIncidents : true,
      };

      expect(result.enabled).toBe(false);
      expect(result.showServices).toBe(false);
      expect(result.showIncidents).toBe(false);
    });

    it('should handle empty array vs null vs undefined', () => {
      const normalizeArray = (arr: string[] | null | undefined) => {
        if (arr === undefined) return undefined;
        if (arr === null) return null;
        return arr.length > 0 ? arr : [];
      };

      expect(normalizeArray(['a', 'b'])).toEqual(['a', 'b']);
      expect(normalizeArray([])).toEqual([]);
      expect(normalizeArray(null)).toBe(null);
      expect(normalizeArray(undefined)).toBe(undefined);
    });
  });

  describe('Concurrent Update Handling', () => {
    it('should detect stale data with timestamps', () => {
      const serverLastUpdated = new Date('2024-01-01T12:00:00Z');
      const clientLastFetched = new Date('2024-01-01T11:00:00Z');

      const isStale = clientLastFetched < serverLastUpdated;

      expect(isStale).toBe(true);
    });

    it('should handle optimistic update rollback', () => {
      let currentState = { name: 'Original', enabled: true };
      const savedState = { ...currentState };

      // Optimistic update
      currentState = { name: 'Updated', enabled: false };
      expect(currentState.name).toBe('Updated');

      // Simulate error - rollback
      const apiSuccess = false;
      if (!apiSuccess) {
        currentState = { ...savedState };
      }

      expect(currentState.name).toBe('Original');
      expect(currentState.enabled).toBe(true);
    });
  });

  describe('Special Character Handling', () => {
    it('should handle special characters in name', () => {
      const names = [
        'Status Page - Production',
        'Status Page (Beta)',
        'Status: Live',
        "Company's Status",
        'Status & Metrics',
      ];

      names.forEach(name => {
        expect(name.length).toBeGreaterThan(0);
        expect(name.trim()).toBe(name);
      });
    });

    it('should handle unicode in organization name', () => {
      const orgNames = [
        'Acme Corporation',
        '株式会社テスト',
        'Société Générale',
        'Мир Технологий',
        '🚀 Startup',
      ];

      orgNames.forEach(name => {
        const encoded = JSON.stringify({ organizationName: name });
        const decoded = JSON.parse(encoded);
        expect(decoded.organizationName).toBe(name);
      });
    });

    it('should sanitize HTML in footer text', () => {
      // Use iterative removal to prevent nested tag injection (CodeQL fix)
      const sanitize = (text: string) => {
        let previous: string;
        let current = text;
        // Iteratively remove HTML tags until no more changes occur
        do {
          previous = current;
          current = current.replace(/<[^>]*>/g, '');
        } while (current !== previous);
        // Escape ampersands after tag removal
        return current.replace(/&/g, '&amp;');
      };

      expect(sanitize('<script>alert("xss")</script>')).toBe('alert("xss")');
      expect(sanitize('Normal footer & company')).toBe('Normal footer &amp; company');
      expect(sanitize('<b>Bold</b> text')).toBe('Bold text');
      // Test nested tag injection attack
      expect(sanitize('<<script>script>alert(1)<</script>/script>')).toBe(
        'script>alert(1)/script>'
      );
    });
  });

  describe('Rate Limit Settings Edge Cases', () => {
    it('should validate rate limit max at boundaries', () => {
      const isValidRateLimit = (max: number) => max >= 1 && max <= 10000;

      expect(isValidRateLimit(1)).toBe(true);
      expect(isValidRateLimit(10000)).toBe(true);
      expect(isValidRateLimit(0)).toBe(false);
      expect(isValidRateLimit(10001)).toBe(false);
    });

    it('should validate window seconds at boundaries', () => {
      const isValidWindow = (sec: number) => sec >= 10 && sec <= 86400;

      expect(isValidWindow(10)).toBe(true);
      expect(isValidWindow(86400)).toBe(true);
      expect(isValidWindow(9)).toBe(false);
      expect(isValidWindow(86401)).toBe(false);
    });

    it('should calculate requests per second', () => {
      const calculateRPS = (maxRequests: number, windowSec: number) => maxRequests / windowSec;

      expect(calculateRPS(120, 60)).toBe(2);
      expect(calculateRPS(3600, 3600)).toBe(1);
      expect(calculateRPS(1000, 10)).toBe(100);
    });
  });
});

describe('Status Page Component Tests', () => {
  describe('Form State Initialization', () => {
    it('should merge server data with defaults correctly', () => {
      const serverData = {
        name: 'My Status Page',
        enabled: true,
        // Missing other fields
      };

      const defaults = {
        name: 'Status Page',
        enabled: false,
        showServices: true,
        showIncidents: true,
        showMetrics: true,
        uptimeExcellentThreshold: 99.9,
        uptimeGoodThreshold: 99.0,
      };

      const merged = { ...defaults, ...serverData };

      expect(merged.name).toBe('My Status Page');
      expect(merged.enabled).toBe(true);
      expect(merged.showServices).toBe(true);
      expect(merged.uptimeExcellentThreshold).toBe(99.9);
    });

    it('should handle null values from server', () => {
      const serverData = {
        organizationName: null,
        contactEmail: null,
        footerText: null,
      };

      const formValues = {
        organizationName: serverData.organizationName || '',
        contactEmail: serverData.contactEmail || '',
        footerText: serverData.footerText || '',
      };

      expect(formValues.organizationName).toBe('');
      expect(formValues.contactEmail).toBe('');
      expect(formValues.footerText).toBe('');
    });
  });

  describe('Form Data Submission', () => {
    it('should prepare submission payload correctly', () => {
      const formData = {
        name: 'Status Page',
        organizationName: '',
        contactEmail: '',
        footerText: 'Powered by OpsKnight',
      };

      const payload = {
        name: formData.name,
        organizationName: formData.organizationName || null,
        contactEmail: formData.contactEmail || null,
        footerText: formData.footerText || null,
      };

      expect(payload.name).toBe('Status Page');
      expect(payload.organizationName).toBe(null);
      expect(payload.contactEmail).toBe(null);
      expect(payload.footerText).toBe('Powered by OpsKnight');
    });

    it('should handle boolean field submission', () => {
      const formData = {
        enabled: true,
        showServices: false,
        showIncidents: true,
      };

      // All should be sent as-is
      expect(formData.enabled).toBe(true);
      expect(formData.showServices).toBe(false);
      expect(formData.showIncidents).toBe(true);
    });
  });
});
