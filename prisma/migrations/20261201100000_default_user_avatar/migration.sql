-- Give people who never picked an avatar one of the bundled knights or Squires, chosen from a hash of their
-- email so it is stable. The "?auto=1" marker lets an identity provider's photo replace it later, and a
-- deliberate pick overwrite it. Only rows with no avatar change, so this is safe to re-run.
UPDATE "User"
SET "avatarUrl" = (ARRAY[
    '/avatars/knight/sentinel.svg?auto=1',
    '/avatars/knight/crusader.svg?auto=1',
    '/avatars/knight/paladin.svg?auto=1',
    '/avatars/knight/warden.svg?auto=1',
    '/avatars/knight/ranger.svg?auto=1',
    '/avatars/knight/vanguard.svg?auto=1',
    '/avatars/knight/bastion.svg?auto=1',
    '/avatars/knight/royal.svg?auto=1',
    '/avatars/knight/direwolf.svg?auto=1',
    '/avatars/knight/lion.svg?auto=1',
    '/avatars/knight/stag.svg?auto=1',
    '/avatars/knight/rose.svg?auto=1',
    '/avatars/knight/sun.svg?auto=1',
    '/avatars/knight/kingsguard.svg?auto=1',
    '/avatars/knight/valkyrie.svg?auto=1',
    '/avatars/knight/duchess.svg?auto=1',
    '/avatars/knight/huntress.svg?auto=1',
    '/avatars/knight/ice-queen.svg?auto=1',
    '/avatars/knight/shield-maiden.svg?auto=1',
    '/avatars/squire/squire.svg?auto=1',
    '/avatars/squire/cheer.svg?auto=1',
    '/avatars/squire/scout.svg?auto=1',
    '/avatars/squire/thinker.svg?auto=1',
    '/avatars/squire/victor.svg?auto=1',
    '/avatars/squire/lady-squire.svg?auto=1',
    '/avatars/squire/lady-aurora.svg?auto=1'
  ])[1 + (abs(hashtext(lower("email"))::bigint) % 26)::int]
WHERE "avatarUrl" IS NULL OR "avatarUrl" = '';
