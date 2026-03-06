import envPaths from "env-paths";

const paths = envPaths("mcp-paprika", { suffix: "" });

export function getConfigDir(): string {
  return paths.config;
}

export function getCacheDir(): string {
  return paths.cache;
}

export function getDataDir(): string {
  return paths.data;
}

export function getLogDir(): string {
  return paths.log;
}

export function getTempDir(): string {
  return paths.temp;
}
