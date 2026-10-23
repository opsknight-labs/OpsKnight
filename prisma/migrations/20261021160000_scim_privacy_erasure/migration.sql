-- Approved privacy erasure may remove the ordinary User principal. Directory
-- references must not prevent that separately authorized lifecycle operation.
ALTER TABLE "ScimIdentity" DROP CONSTRAINT "ScimIdentity_userId_fkey";
ALTER TABLE "ScimIdentity" ADD CONSTRAINT "ScimIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScimGroupMembership" DROP CONSTRAINT "ScimGroupMembership_userId_fkey";
ALTER TABLE "ScimGroupMembership" ADD CONSTRAINT "ScimGroupMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
