# Cross-Cutting Utilities

Last verified: 2026-03-06

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

### duration.ts — Recipe duration parsing and formatting

Parses duration strings in multiple formats (human-readable, ISO 8601, H:MM colon, bare
numbers) into Luxon `Duration` objects. Returns `Result<Duration, DurationParseError>` using
neverthrow. Formats durations as compact human-readable strings. No I/O. No internal
dependencies (leaf module).

| Function                   | Returns                                    |
| -------------------------- | ------------------------------------------ |
| `parseDuration(input)`     | `Result<Duration, DurationParseError>`     |
| `formatDuration(duration)` | Compact string (e.g., "1 hr 30 min") or "" |

| Class                | Extends | Fields                                      |
| -------------------- | ------- | ------------------------------------------- |
| `DurationParseError` | `Error` | `input: string \| number`, `reason: string` |

## Dependencies

- **Uses:** None (leaf module — no internal project imports)
- **External packages:** xdg.ts uses `env-paths`; duration.ts uses `luxon`, `parse-duration`, `neverthrow`
- **Used by:** All other `src/` modules
- **Boundary:** Must not import from any other `src/` module (leaf dependency)
