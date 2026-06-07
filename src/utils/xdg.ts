import { join } from "node:path";

import envPaths from "env-paths";

const PROGRAM_NAME = "mcp-paprika";

// env-paths's macOS branch hard-codes ~/Library/{Preferences,Caches,...} and
// ignores XDG_* env vars entirely.  Re-implement the XDG override on every
// platform so tests that set XDG_CACHE_HOME / XDG_CONFIG_HOME actually work.

export function getConfigDir(): string {
  const override = process.env["XDG_CONFIG_HOME"];
  if (override !== undefined && override !== "") return join(override, PROGRAM_NAME);
  return envPaths(PROGRAM_NAME, { suffix: "" }).config;
}

export function getCacheDir(): string {
  const override = process.env["XDG_CACHE_HOME"];
  if (override !== undefined && override !== "") return join(override, PROGRAM_NAME);
  return envPaths(PROGRAM_NAME, { suffix: "" }).cache;
}

export function getDataDir(): string {
  const override = process.env["XDG_DATA_HOME"];
  if (override !== undefined && override !== "") return join(override, PROGRAM_NAME);
  return envPaths(PROGRAM_NAME, { suffix: "" }).data;
}

export function getLogDir(): string {
  const override = process.env["XDG_STATE_HOME"];
  if (override !== undefined && override !== "") return join(override, PROGRAM_NAME);
  return envPaths(PROGRAM_NAME, { suffix: "" }).log;
}

export function getTempDir(): string {
  return envPaths(PROGRAM_NAME, { suffix: "" }).temp;
}
