-- Add provider enum values separately before governance table changes.
ALTER TYPE "AiProviderKind" ADD VALUE IF NOT EXISTS 'AZURE_OPENAI';
ALTER TYPE "AiProviderKind" ADD VALUE IF NOT EXISTS 'BEDROCK';
ALTER TYPE "AiProviderKind" ADD VALUE IF NOT EXISTS 'VERTEX';
ALTER TYPE "AiProviderKind" ADD VALUE IF NOT EXISTS 'MISTRAL';
ALTER TYPE "AiProviderKind" ADD VALUE IF NOT EXISTS 'GROQ';
