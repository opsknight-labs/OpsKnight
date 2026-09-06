-- Add emailVerified to User for NextAuth Prisma adapter
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerified" TIMESTAMP(3);
