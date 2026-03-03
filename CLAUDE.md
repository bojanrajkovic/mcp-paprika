# mcp-paprika

Last verified: 2026-03-02

## Tech Stack
- Runtime: Node.js 24 (managed via mise)
- Language: TypeScript 5.9 (strictest + node24 tsconfig presets)
- Module system: ESM (`"type": "module"`)
- Package manager: pnpm 10.30.3 (corepack)
- Key deps: zod (validation), luxon (dates), dotenv (env config), parse-duration

## Commands
- `pnpm dev` - Run dev server via tsx
- `pnpm build` - Compile TypeScript to dist/

## Project Structure
- `src/index.ts` - Entry point
- `src/paprika/` - Paprika API client
- `src/cache/` - Caching layer
- `src/tools/` - MCP tool definitions
- `src/resources/` - MCP resource definitions
- `src/features/` - Feature implementations
- `src/types/` - Shared type definitions
- `src/utils/` - Cross-cutting utilities

## Conventions
- ESM-only: use `import`/`export`, no CommonJS
- Strict TypeScript: extends @tsconfig/strictest
- Source in `src/`, compiled output in `dist/`

## Boundaries
- `dist/` and `node_modules/` are gitignored, never edit
- `.env` files contain secrets, never commit
- `pnpm-lock.yaml` is auto-generated, do not hand-edit
