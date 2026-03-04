# Suggested Commands

## Development
```bash
bun run dev              # Start dev server with hot reload (bun --watch)
bun run build            # TypeScript build (tsc → dist/)
bun run start            # Run built app (bun dist/index.js)
```

## Testing
```bash
bun run test             # Run all tests (vitest run)
bun run test:watch       # Test watch mode
bun vitest run tests/settings.test.ts  # Run a single test file
```

## Code Quality
```bash
bun run check            # Biome lint + format check
bun run check:fix        # Biome auto-fix
bun run typecheck        # Type check only (tsc --noEmit)
```

## Docker
```bash
docker compose up thor -d --build   # Build and run in Docker
```

## Git / System (macOS / Darwin)
```bash
git status               # Check repo status
git log --oneline -10    # Recent commits
git diff                 # View unstaged changes
ls -la                   # List files
find . -name "*.ts"      # Find TypeScript files
grep -r "pattern" src/   # Search in source
```
