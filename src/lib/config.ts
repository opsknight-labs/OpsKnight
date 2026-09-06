const numberFromEnv = (value: string | undefined, fallback: number) => {
    if (!value) {
        return fallback;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

export const EVENT_TRANSACTION_MAX_ATTEMPTS = numberFromEnv(
    process.env.EVENT_TRANSACTION_MAX_ATTEMPTS,
    5
);

export const ESCALATION_LOCK_TIMEOUT_MS = numberFromEnv(
    process.env.ESCALATION_LOCK_TIMEOUT_MS,
    5 * 60 * 1000
);
