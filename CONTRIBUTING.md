# Contributing to OpsKnight

Thank you for your interest in contributing to OpsKnight! This document provides guidelines and information for contributors.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Security Policy](#security-policy)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Pull Request Process](#pull-request-process)
- [Style Guidelines](#style-guidelines)

## Code of Conduct

This project adheres to the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Security Policy

Please review our [Security Policy](SECURITY.md) for instructions on how to report vulnerabilities.

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Git

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/opsknight.git
   cd opsknight
   ```
3. Add upstream remote:
   ```bash
   git remote add upstream https://github.com/opsknight-labs/opsknight.git
   ```

## Development Setup

```bash
# Install dependencies
npm install

# Copy environment file
cp env.example .env

# Start PostgreSQL (Docker)
docker compose up -d postgres

# Run database migrations
npx prisma migrate deploy
npx prisma generate

# Start development server
npm run dev
```

## Making Changes

### Branch Naming

- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation changes
- `refactor/` - Code refactoring

Example: `feature/slack-thread-replies`

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

feat(slack): add thread reply support
fix(auth): resolve SSO redirect loop
docs(api): update events endpoint examples
```

### Testing

```bash
# Run all tests
npm test

# Run specific test file
npm test path/to/test.ts

# Run with coverage
npm run test:coverage
```

## Pull Request Process

1. **Update from upstream**

   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Create a branch**

   ```bash
   git checkout -b feature/your-feature
   ```

3. **Make changes and test**

   ```bash
   npm test
   npm run lint
   ```

4. **Push and create PR**

   ```bash
   git push origin feature/your-feature
   ```

5. **PR Requirements**
   - Clear description of changes
   - Tests for new functionality
   - Documentation updates if needed
   - All CI checks passing

## Style Guidelines

### TypeScript

- Use TypeScript for all new code
- Enable strict mode
- Prefer interfaces over types for objects
- Use meaningful variable names

### React

- Use functional components
- Follow React hooks rules
- Keep components focused and small
- Use proper prop typing

### CSS

- Use CSS variables for theming
- Follow BEM naming when applicable
- Mobile-first responsive design

### Code Quality

- ESLint and Prettier are enforced
- Run `npm run lint` before committing
- Husky pre-commit hooks are enabled

## Questions?

- Open a [GitHub Issue](https://github.com/opsknight-labs/opsknight/issues)
- Check existing issues and discussions

---

Thank you for contributing! 🎉
