import { scimError } from '@/lib/scim';

function notFound() {
  return scimError(404, 'The requested SCIM resource was not found.');
}

export async function GET() {
  return notFound();
}

export async function POST() {
  return notFound();
}

export async function PUT() {
  return notFound();
}

export async function PATCH() {
  return notFound();
}

export async function DELETE() {
  return notFound();
}

export async function HEAD() {
  return notFound();
}

export async function OPTIONS() {
  return notFound();
}
