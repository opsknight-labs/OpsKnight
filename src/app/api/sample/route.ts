import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey } from '@/lib/api-auth';

function detectAuthMethod(req: NextRequest): string {
  const authHeader = req.headers.get('authorization') || '';
  if (authHeader.toLowerCase().startsWith('bearer ')) return 'Bearer';
  if (authHeader.toLowerCase().startsWith('api-key ')) return 'API-Key';
  if (req.headers.get('x-api-key')) return 'X-API-Key';
  return 'None';
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  const authMethod = detectAuthMethod(req);
  const apiKey = await authenticateApiKey(req);

  if (!apiKey) {
    return NextResponse.json(
      {
        status: 'unauthenticated',
        authenticated: false,
        message: 'No valid API key provided. Pass your key in Authorization: Bearer <TOKEN> or X-API-Key: <TOKEN>.',
        detectedAuthMethod: authMethod,
        supportedHeaders: [
          'Authorization: Bearer <TOKEN>',
          'X-API-Key: <TOKEN>',
        ],
        documentation: '/settings/api-keys?tab=explorer',
        timestamp: new Date().toISOString(),
      },
      { status: 200, headers: CORS_HEADERS }
    );
  }

  return NextResponse.json(
    {
      status: 'success',
      authenticated: true,
      message: 'API Key verified successfully. Your programmatic connection to OpsKnight is working.',
      authMethod,
      key: {
        id: apiKey.id,
        name: apiKey.name,
        prefix: apiKey.prefix,
        scopes: apiKey.scopes,
      },
      timestamp: new Date().toISOString(),
      server: 'OpsKnight Enterprise REST Engine',
    },
    { status: 200, headers: CORS_HEADERS }
  );
}

export async function POST(req: NextRequest) {
  const authMethod = detectAuthMethod(req);
  const apiKey = await authenticateApiKey(req);

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // Body is optional for sample ping
    body = null;
  }

  if (!apiKey) {
    return NextResponse.json(
      {
        status: 'unauthenticated',
        authenticated: false,
        message: 'API key authentication required for POST /api/sample. Provide Bearer or X-API-Key credentials.',
        detectedAuthMethod: authMethod,
        timestamp: new Date().toISOString(),
      },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  return NextResponse.json(
    {
      status: 'success',
      authenticated: true,
      message: 'Sample request payload received and validated successfully.',
      authMethod,
      key: {
        id: apiKey.id,
        name: apiKey.name,
        prefix: apiKey.prefix,
        scopes: apiKey.scopes,
      },
      echo: body,
      timestamp: new Date().toISOString(),
    },
    { status: 200, headers: CORS_HEADERS }
  );
}
