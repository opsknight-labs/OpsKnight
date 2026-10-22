-- Serialize every identity-creation path, including SQL/JIT/invitations, without
-- rewriting or merging historical case variants. Installation blocks User writes.
LOCK TABLE "User" IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE "UserEmailReservation" (
  "canonicalEmail" TEXT NOT NULL PRIMARY KEY,
  "holders" INTEGER NOT NULL CHECK ("holders" >= 0)
);
INSERT INTO "UserEmailReservation" ("canonicalEmail", "holders")
SELECT lower(email), count(*)::integer FROM "User" GROUP BY lower(email);

CREATE FUNCTION maintain_user_email_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND lower(NEW.email) = lower(OLD.email) THEN
    RETURN NEW;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    INSERT INTO "UserEmailReservation" ("canonicalEmail", "holders")
    VALUES (lower(NEW.email), 1) ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A user with this canonical email already exists'
        USING ERRCODE = '23505', CONSTRAINT = 'User_email_canonical_key';
    END IF;
  END IF;
  IF TG_OP IN ('DELETE', 'UPDATE') THEN
    -- Atomic counters retain reservations until the last historical holder leaves.
    UPDATE "UserEmailReservation" SET "holders" = "holders" - 1
      WHERE "canonicalEmail" = lower(OLD.email);
    DELETE FROM "UserEmailReservation"
      WHERE "canonicalEmail" = lower(OLD.email) AND "holders" = 0;
  END IF;
  RETURN NULL; -- AFTER trigger: never rewrites the user row.
END;
$$;
CREATE TRIGGER user_canonical_email_reservation
AFTER INSERT OR UPDATE OF email OR DELETE ON "User"
FOR EACH ROW EXECUTE FUNCTION maintain_user_email_reservation();
