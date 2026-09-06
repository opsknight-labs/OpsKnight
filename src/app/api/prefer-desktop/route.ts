import { NextResponse } from 'next/server';

export async function GET() {
    const response = NextResponse.redirect(new URL('/', process.env.NEXTAUTH_URL || 'http://localhost:3000'));

    response.cookies.set('prefer-desktop', 'true', {
        maxAge: 60 * 60 * 24 * 365, // 1 year
        path: '/',
    });

    return response;
}
