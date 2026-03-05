# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
bun run dev          # Start dev server (bun --watch)
bun run build        # TypeScript build (tsc → dist/)
bun run check        # Biome lint + format check
bun run check:fix    # Biome auto-fix
bun run typecheck    # Type check only (tsc --noEmit)
bun run test         # Run tests (bun test)
bun run test:watch   # Test watch mode
bun test tests/settings.test.ts  # Run a single test
```

Docker: `docker compose up thor -d --build`

## Architecture

```
User → Discord → thor (index.ts) → spawn claude -p → Claude CLI → Workspace
                                       ↕ HTTP MCP
                                  thor HTTP MCP Server (discord/schedule tools)
```

thor is a wrapper that invokes Claude Code CLI from Discord chat. Designed for single-user use.
See Serena memory `project_overview` for detailed layer structure and data flows.

## Code Navigation & Editing

Prefer Serena MCP tools over Read/Edit/Grep for code:
- **Explore**: `get_symbols_overview` → `find_symbol` → `find_referencing_symbols`
- **Edit**: `replace_symbol_body` (whole symbol), `replace_content` (partial, regex)
- **Insert**: `insert_after_symbol` / `insert_before_symbol`
- **Rename**: `rename_symbol` (codebase-wide)
- Use standard Read/Edit only for non-code files (config, docs).

## Development Practices

- **TDD (t-wada style)**: Write a failing test first, make it pass with minimal code, then refactor. Red → Green → Refactor cycle.
- **Tidying (Kent Beck style)**: Separate structural changes from behavioral changes. Make tidying commits (rename, extract, reorder) independently from feature/fix commits.
- **Conventional Commits**: Commit and push at appropriate milestones. Use `feat:`, `fix:`, `refactor:`, `test:`, `chore:`, etc. Keep commits small and focused.
- **Language**: Write all commit messages and README content in English.
