/* eslint-disable security/detect-object-injection -- Attribute keys are restricted by strict SCIM schemas and explicit path allowlists. */
import {
  groupSchema,
  operations,
  parse,
  ScimFailure,
  userSchema,
  enterpriseSchema,
} from './validation';

export type UserDocument = ReturnType<typeof userSchema.parse>;
export function patchUser(existing: UserDocument, body: unknown) {
  const document: Record<string, unknown> = structuredClone(existing);
  const apply = (path: string, value: unknown, remove: boolean) => {
    const key = path.toLowerCase();
    if (key === 'active' && typeof value === 'string' && /^(true|false)$/i.test(value))
      value = value.toLowerCase() === 'true';
    if (key === 'externalid') {
      if (remove || value !== existing.externalId)
        throw new ScimFailure(400, 'externalId is immutable.', 'mutability');
      return;
    }
    const simple: Record<string, string> = {
      username: 'userName',
      displayname: 'displayName',
      active: 'active',
      title: 'title',
      photos: 'photos',
      emails: 'emails',
    };
    if (simple[key]) {
      if (remove && ['username', 'active', 'emails'].includes(key))
        throw new ScimFailure(400, `${path} is required.`, 'mutability');
      if (remove && key === 'displayname') {
        // formatted was synthesized from the stored display name, not independently owned.
        const name = { ...((document.name as Record<string, unknown>) ?? {}) };
        if (name.formatted === document.displayName) delete name.formatted;
        document.name = name;
      }
      if (remove) delete document[simple[key]];
      else document[simple[key]] = value;
      // OpsKnight's work email and login name are one authoritative attribute.
      if (key === 'username') document.emails = [{ value, type: 'work', primary: true }];
      if (key === 'emails') {
        const parsed = parse(userSchema, {
          ...document,
          userName: Array.isArray(value) ? value[0]?.value : document.userName,
        });
        document.userName = parsed.userName;
      }
      return;
    }
    if (/^emails\[type eq ["']work["']\]\.value$/i.test(path)) {
      if (remove) throw new ScimFailure(400, 'The work email is required.', 'mutability');
      document.userName = value;
      document.emails = [{ value, type: 'work', primary: true }];
      return;
    }
    if (key === 'name') {
      delete document.displayName;
      if (remove) delete document.name;
      else document.name = value;
      return;
    }
    if (['name.formatted', 'name.givenname', 'name.familyname'].includes(key)) {
      const name = { ...((document.name as Record<string, unknown>) ?? {}) };
      const sub =
        key === 'name.givenname'
          ? 'givenName'
          : key === 'name.familyname'
            ? 'familyName'
            : 'formatted';
      if (remove) delete name[sub];
      else name[sub] = value;
      if (sub !== 'formatted') delete name.formatted;
      document.name = name;
      delete document.displayName;
      return;
    }
    if (key === enterpriseSchema.toLowerCase()) {
      if (remove) delete document[enterpriseSchema];
      else document[enterpriseSchema] = value;
      return;
    }
    if (key === `${enterpriseSchema}:department`.toLowerCase()) {
      document[enterpriseSchema] = { department: remove ? null : value };
      return;
    }
    throw new ScimFailure(400, `Unsupported User path: ${path}.`, 'invalidPath');
  };
  for (const operation of operations(body)) {
    if (!operation.path) {
      if (
        operation.op === 'remove' ||
        !operation.value ||
        typeof operation.value !== 'object' ||
        Array.isArray(operation.value)
      )
        throw new ScimFailure(400, 'An attribute object is required for a pathless operation.');
      for (const [key, value] of Object.entries(operation.value)) apply(key, value, false);
    } else apply(operation.path, operation.value, operation.op === 'remove');
  }
  return parse(userSchema, document);
}
export type GroupDocument = ReturnType<typeof groupSchema.parse>;
export function patchGroup(existing: GroupDocument, body: unknown) {
  const next = structuredClone(existing);
  let members = new Set((next.members ?? []).map(m => m.value));
  const apply = (path: string, value: unknown, op: string) => {
    const lower = path.toLowerCase();
    if (lower === 'displayname') {
      if (op === 'remove') throw new ScimFailure(400, 'displayName is required.', 'mutability');
      next.displayName = parse(groupSchema.shape.displayName, value);
      return;
    }
    if (lower === 'externalid') {
      if (op === 'remove' || (existing.externalId && value !== existing.externalId))
        throw new ScimFailure(400, 'externalId is immutable.', 'mutability');
      next.externalId = parse(groupSchema.shape.externalId.unwrap(), value);
      return;
    }
    const filtered = /^members\[value\s+eq\s+"([^"\r\n]{1,320})"\]$/i.exec(path);
    if (filtered) {
      if (op !== 'remove')
        throw new ScimFailure(400, 'Filtered members only support remove.', 'invalidPath');
      members.delete(filtered[1]);
      return;
    }
    if (lower !== 'members')
      throw new ScimFailure(400, `Unsupported Group path: ${path}.`, 'invalidPath');
    if (op === 'remove' && value === undefined) {
      members.clear();
      return;
    }
    const list = parse(groupSchema.shape.members.unwrap(), Array.isArray(value) ? value : [value]);
    if (op === 'replace') members = new Set(list.map(m => m.value));
    else
      for (const member of list) {
        if (op === 'add') members.add(member.value);
        else members.delete(member.value);
      }
  };
  for (const operation of operations(body)) {
    if (!operation.path) {
      if (
        operation.op === 'remove' ||
        !operation.value ||
        typeof operation.value !== 'object' ||
        Array.isArray(operation.value)
      )
        throw new ScimFailure(400, 'A pathless operation requires an attribute object.');
      for (const [key, value] of Object.entries(operation.value)) apply(key, value, operation.op);
    } else apply(operation.path, operation.value, operation.op);
  }
  return parse(groupSchema, { ...next, members: [...members].map(value => ({ value })) });
}
