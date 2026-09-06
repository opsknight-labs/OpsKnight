import { NextRequest } from 'next/server';

export async function createMockRequest(
    method: string,
    url: string,
    body?: Record<string, unknown>,
    headers: Record<string, string> = {}
) {
    const options: RequestInit = {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...headers,
        },
    };

    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
        options.body = JSON.stringify(body);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new NextRequest(new URL(url, 'http://localhost:3000'), options as any);
}

export async function parseResponse(response: Response) {
    const status = response.status;
    let data = null;
    try {
        data = await response.json();
    } catch (_e) {
        // Not JSON
    }
    return { status, data };
}
