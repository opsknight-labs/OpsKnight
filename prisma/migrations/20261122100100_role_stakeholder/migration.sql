-- Own file: a new enum value cannot be used in the transaction that adds it.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'STAKEHOLDER';
