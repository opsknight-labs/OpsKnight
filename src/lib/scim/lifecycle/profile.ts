import type { User } from '@prisma/client';
import { operations, ScimFailure } from '../protocol/validation';
type Profile = Pick<
  User,
  'email' | 'name' | 'jobTitle' | 'department' | 'scimGivenName' | 'scimFamilyName' | 'avatarUrl'
>;
export function requestedProfileFields(body: unknown, method: string) {
  const paths =
    method === 'PATCH'
      ? operations(body).flatMap(operation =>
          operation.path ? [operation.path] : Object.keys(operation.value as object)
        )
      : Object.keys(body as object);
  return new Set(
    paths.map(path => {
      const key = path.toLowerCase();
      if (key === 'displayname' || key === 'name' || key.startsWith('name.')) return 'name';
      if (key === 'username' || key.startsWith('emails')) return 'email';
      if (key.startsWith('urn:ietf:params:scim:schemas:extension:enterprise:2.0:user'))
        return 'department';
      return key;
    })
  );
}
/** Unowned fields remain unchanged; explicit attempts to change them fail atomically. */
export function applyProfileAuthority(
  next: Profile,
  current: Profile,
  owned: string[],
  touched: Set<string>
) {
  const preserve = (field: string, changed: boolean, restore: () => void) => {
    if (owned.includes(field)) return;
    if (changed && touched.has(field))
      throw new ScimFailure(400, `${field} is managed outside this SCIM connection.`, 'mutability');
    restore();
  };
  preserve(
    'name',
    next.name !== current.name ||
      next.scimGivenName !== current.scimGivenName ||
      next.scimFamilyName !== current.scimFamilyName,
    () => {
      next.name = current.name;
      next.scimGivenName = current.scimGivenName;
      next.scimFamilyName = current.scimFamilyName;
    }
  );
  preserve('email', next.email !== current.email, () => {
    next.email = current.email;
  });
  preserve('title', next.jobTitle !== current.jobTitle, () => {
    next.jobTitle = current.jobTitle;
  });
  preserve('department', next.department !== current.department, () => {
    next.department = current.department;
  });
  preserve('photos', next.avatarUrl !== current.avatarUrl, () => {
    next.avatarUrl = current.avatarUrl;
  });
  return next;
}
