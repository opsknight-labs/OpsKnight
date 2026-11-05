# Claude Code Guidelines - OpsKnight

> This file instructs Claude Code on repository commands, architecture, and coding conventions.
> It works in tandem with the primary universal playbook: `@AGENTS.md`.

---

## 1. Essential Commands

```bash
# Development server
npm run dev

# Production build
npm run build

# Typecheck
npx tsc --noEmit

# Unit & Integration Tests (Vitest)
npm test
npx vitest run tests/lib/<test-file>.test.ts

# Linting
npm run lint
npx eslint <path-to-file>

# Prisma / Database
npx prisma generate
npx prisma migrate dev
npx prisma studio
```

---

## 2. Critical Workflow Rules

1. **NEVER Merge Directly**: Under no circumstances execute `git merge`, `gh pr merge`, or merge into `main` directly.
2. **Feature Branching**: Always create a feature branch (`feat/...`, `fix/...`) for all changes.
3. **PR Protocol**: Push the branch, create a Pull Request with a clear description, share the PR URL with the user, and stop.
4. **Pre-Push Gate**: Always run `npx tsc --noEmit`, `npx eslint`, and relevant `vitest` tests before committing.

---

## 3. Architecture & Code Conventions

- **Next.js 15 App Router**: Prefer Server Components. Use `'use client'` only where interactive state or browser APIs are required. Use Server Actions (`'use server'`) in dedicated `actions.ts` files.
- **RBAC**: Always enforce permissions in Server Actions via `getUserPermissions()` from `@/lib/rbac`.
- **Validation**: Validate all inputs with Zod schemas.
- **Styling**: Tailwind CSS, Radix UI primitives, Space Grotesk for headers/brand marks (`font-display`), Inter for body (`font-sans`). Status colours come from Tailwind `status-*` tokens.
- **OpsKnight Branding**: Use background-less transparent logo (`/logo.png`), no dark background boxes, and hyperlink all OpsKnight marks to `https://opsknight.com/`.
- **Responsive Widths**: Support mobile up to 27-inch (1080px) and 4K (1180px) screens (email container widths; the app console is fluid).

For detailed guidelines on email templates, status color semantics, and database invariants, refer to `@AGENTS.md`.
