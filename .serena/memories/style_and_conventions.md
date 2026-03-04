# Code Style and Conventions

## TypeScript Configuration
- Target: ES2022
- Module: NodeNext (with NodeNext resolution)
- Strict mode enabled
- Declaration files generated

## Biome Formatter
- Indent: 2 spaces
- Line width: 100
- Quotes: single quotes
- Trailing commas: ES5
- Semicolons: always

## Biome Linter Rules
- `noUnusedVariables`: error
- `noUnusedImports`: error
- `noExplicitAny`: warn

## Naming Conventions
- Files: kebab-case (`agent-runner.ts`, `discord-client.ts`)
- Functions: camelCase (`loadConfig`, `routeMessage`)
- Constants: camelCase for module-level (`logger`)
- Types/Interfaces: PascalCase (`Config`, `AgentConfig`)
- Zod schemas: PascalCase with `Schema` suffix (`ConfigSchema`, `HeartbeatConfigSchema`)

## Configuration Pattern
- Zod schemas for validation (v4)
- `loadConfig()` reads from environment variables
- Helper functions like `parseIntEnv()`, `resolvePath()`

## Development Practices
- **TDD (t-wada style)**: Red → Green → Refactor cycle
- **Tidying (Kent Beck style)**: Separate structural from behavioral changes
- **Conventional Commits**: `feat:`, `fix:`, `refactor:`, `test:`, `chore:`, etc.
- **Language**: Commit messages and README in English
- **Pre-commit**: Lefthook runs lint-staged (Biome check --write)

## Git Hooks
- Pre-commit: `bun run lint-staged` (auto-fixes via Biome)
