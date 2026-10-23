-- Non-unique: preserve historical accounts and casing; SCIM collision checks never adopt by email.
CREATE INDEX "User_email_scim_lower_idx" ON "User" (lower(email));
