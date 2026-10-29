export function mockUser(overrides = {}) {
    return {
        id: `user-${Math.random().toString(36).substr(2, 9)}`,
        email: 'test@example.com',
        name: 'Test User',
        role: 'USER',
        emailNotificationsEnabled: true,
        smsNotificationsEnabled: false,
        pushNotificationsEnabled: false,
        whatsappNotificationsEnabled: false,
        ...overrides,
    };
}

export function mockTeam(overrides = {}) {
    return {
        id: `team-${Math.random().toString(36).substr(2, 9)}`,
        name: 'Engineers',
        ...overrides,
    };
}

export function mockService(overrides = {}) {
    return {
        id: `svc-${Math.random().toString(36).substr(2, 9)}`,
        name: 'API Service',
        serviceNotificationChannels: ['EMAIL'],
        ...overrides,
    };
}

export function mockIncident(overrides = {}) {
    return {
        id: `inc-${Math.random().toString(36).substr(2, 9)}`,
        title: 'Database Outage',
        status: 'TRIGGERED',
        urgency: 'HIGH',
        serviceId: 'svc-1',
        createdAt: new Date().toISOString(),
        ...overrides,
    };
}
