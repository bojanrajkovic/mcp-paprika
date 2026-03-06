# Cross-Cutting Utilities

Last verified: 2026-03-05

## Purpose

Shared utility functions and helpers used across multiple modules. Includes error base classes, logging helpers, and common transformations.

## Contracts

### xdg.ts — Platform-native application directory paths

Wraps `env-paths` v4 with app name `mcp-paprika` (no suffix). Exports 5 synchronous functions
that return absolute path strings. No I/O. No internal dependencies (leaf module).

| Function         | Returns                          |
| ---------------- | -------------------------------- |
| `getConfigDir()` | Platform-native config directory |
| `getCacheDir()`  | Platform-native cache directory  |
| `getDataDir()`   | Platform-native data directory   |
| `getLogDir()`    | Platform-native log directory    |
| `getTempDir()`   | Platform-native temp directory   |

## Dependencies

- **Uses:** None (leaf dependency)
- **Used by:** All other `src/` modules
- **Boundary:** Must not import from any other `src/` module (leaf dependency)
