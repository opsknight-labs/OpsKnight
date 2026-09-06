import prisma from '@/lib/prisma';

export class UniqueNameConflictError extends Error {
    readonly entity: string;

    constructor(entity: string, name: string) {
        super(`${entity} name "${name}" is already in use.`);
        this.name = 'UniqueNameConflictError';
        this.entity = entity;
    }
}

type NameOptions = {
    excludeId?: string;
    serviceId?: string;
};

async function assertNameAvailable(
    entity: string,
    name: string,
    options: NameOptions,
    findExisting: (name: string, excludeId?: string) => Promise<{ id: string } | null>
) {
    const trimmedName = name.trim();

    if (!trimmedName) {
        throw new Error(`${entity} name is required.`);
    }

    const existing = await findExisting(trimmedName, options.excludeId);

    if (existing) {
        throw new UniqueNameConflictError(entity, trimmedName);
    }

    return trimmedName;
}

export async function assertServiceNameAvailable(name: string, options: NameOptions = {}) {
    return assertNameAvailable('Service', name, options, (value, excludeId) =>
        prisma.service.findFirst({
            where: {
                name: value,
                ...(excludeId ? { NOT: { id: excludeId } } : {})
            },
            select: { id: true }
        })
    );
}

export async function assertTeamNameAvailable(name: string, options: NameOptions = {}) {
    return assertNameAvailable('Team', name, options, (value, excludeId) =>
        prisma.team.findFirst({
            where: {
                name: value,
                ...(excludeId ? { NOT: { id: excludeId } } : {})
            },
            select: { id: true }
        })
    );
}

export async function assertEscalationPolicyNameAvailable(name: string, options: NameOptions = {}) {
    return assertNameAvailable('Escalation policy', name, options, (value, excludeId) =>
        prisma.escalationPolicy.findFirst({
            where: {
                name: value,
                ...(excludeId ? { NOT: { id: excludeId } } : {})
            },
            select: { id: true }
        })
    );
}

export async function assertScheduleNameAvailable(name: string, options: NameOptions = {}) {
    return assertNameAvailable('Schedule', name, options, (value, excludeId) =>
        prisma.onCallSchedule.findFirst({
            where: {
                name: value,
                ...(excludeId ? { NOT: { id: excludeId } } : {})
            },
            select: { id: true }
        })
    );
}

export async function assertIncidentTemplateNameAvailable(name: string, options: NameOptions = {}) {
    return assertNameAvailable('Incident template', name, options, (value, excludeId) =>
        prisma.incidentTemplate.findFirst({
            where: {
                name: value,
                ...(excludeId ? { NOT: { id: excludeId } } : {})
            },
            select: { id: true }
        })
    );
}

export async function assertWebhookIntegrationNameAvailable(name: string, options: NameOptions = {}) {
    if (!options.serviceId) {
        throw new Error('Webhook integration serviceId is required.');
    }
    return assertNameAvailable('Webhook integration', name, options, (value, excludeId) =>
        prisma.webhookIntegration.findFirst({
            where: {
                serviceId: options.serviceId,
                name: value,
                ...(excludeId ? { NOT: { id: excludeId } } : {})
            },
            select: { id: true }
        })
    );
}

export async function assertStatusPageNameAvailable(name: string, options: NameOptions = {}) {
    return assertNameAvailable('Status page', name, options, (value, excludeId) =>
        prisma.statusPage.findFirst({
            where: {
                name: value,
                ...(excludeId ? { NOT: { id: excludeId } } : {})
            },
            select: { id: true }
        })
    );
}
