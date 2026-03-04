# Task Completion Checklist

When a coding task is completed, run the following checks:

## 1. Code Quality
```bash
bun run check          # Biome lint + format check
bun run typecheck      # TypeScript type check (tsc --noEmit)
```

## 2. Tests
```bash
bun run test           # Run all tests (vitest run)
```

## 3. Build (if applicable)
```bash
bun run build          # Ensure TypeScript compiles cleanly
```

## 4. Git Workflow (MANDATORY per AGENTS.md)
```bash
git add <changed-files>
git commit -m "type: description"   # Conventional commits
git pull --rebase
git push
git status   # Must show "up to date with origin"
```

**CRITICAL**: Work is NOT complete until `git push` succeeds. Never stop before pushing.

## Commit Message Format
- `feat:` - New feature
- `fix:` - Bug fix
- `refactor:` - Code restructuring
- `test:` - Test additions/changes
- `chore:` - Maintenance tasks
- `docs:` - Documentation updates

Keep commits small and focused. Separate structural (tidying) from behavioral changes.
