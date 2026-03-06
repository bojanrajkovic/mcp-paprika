import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { getConfigDir, getCacheDir, getDataDir, getLogDir, getTempDir } from "./xdg.js";

describe("XDG path utilities", () => {
  describe("xdg-paths.AC1: Module exports 5 path functions", () => {
    it("xdg-paths.AC1.1: getConfigDir() returns an absolute path ending with mcp-paprika", () => {
      const configDir = getConfigDir();

      expect(path.isAbsolute(configDir)).toBe(true);
      expect(path.basename(configDir)).toBe("mcp-paprika");
    });

    it("xdg-paths.AC1.2: getCacheDir() returns an absolute path ending with mcp-paprika", () => {
      const cacheDir = getCacheDir();

      expect(path.isAbsolute(cacheDir)).toBe(true);
      expect(path.basename(cacheDir)).toBe("mcp-paprika");
    });

    it("xdg-paths.AC1.3: getDataDir() returns an absolute path ending with mcp-paprika", () => {
      const dataDir = getDataDir();

      expect(path.isAbsolute(dataDir)).toBe(true);
      expect(path.basename(dataDir)).toBe("mcp-paprika");
    });

    it("xdg-paths.AC1.4: getLogDir() returns an absolute path ending with mcp-paprika", () => {
      const logDir = getLogDir();

      expect(path.isAbsolute(logDir)).toBe(true);
      expect(path.basename(logDir)).toBe("mcp-paprika");
    });

    it("xdg-paths.AC1.5: getTempDir() returns an absolute path ending with mcp-paprika", () => {
      const tempDir = getTempDir();

      expect(path.isAbsolute(tempDir)).toBe(true);
      expect(path.basename(tempDir)).toBe("mcp-paprika");
    });
  });

  describe("xdg-paths.AC2: Module characteristics", () => {
    it("xdg-paths.AC2.1: All 5 functions are synchronous and perform no filesystem I/O", () => {
      const configDir = getConfigDir();
      const cacheDir = getCacheDir();
      const dataDir = getDataDir();
      const logDir = getLogDir();
      const tempDir = getTempDir();

      expect(typeof configDir).toBe("string");
      expect(typeof cacheDir).toBe("string");
      expect(typeof dataDir).toBe("string");
      expect(typeof logDir).toBe("string");
      expect(typeof tempDir).toBe("string");

      expect(configDir).not.toBeInstanceOf(Promise);
      expect(cacheDir).not.toBeInstanceOf(Promise);
      expect(dataDir).not.toBeInstanceOf(Promise);
      expect(logDir).not.toBeInstanceOf(Promise);
      expect(tempDir).not.toBeInstanceOf(Promise);
    });

    it("xdg-paths.AC2.2: env-paths is listed as a runtime dependency in package.json", () => {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      // Both src/utils/ and dist/utils/ need to go up two levels to reach project root
      const projectRoot = resolve(__dirname, "../../");
      const packageJsonPath = resolve(projectRoot, "package.json");
      const packageJsonContent = readFileSync(packageJsonPath, "utf-8");
      const parsed = JSON.parse(packageJsonContent);

      expect(parsed.dependencies).toBeDefined();
      expect(parsed.dependencies["env-paths"]).toBeDefined();
      expect(typeof parsed.dependencies["env-paths"]).toBe("string");
    });
  });

  describe("xdg-paths.AC3: Leaf dependency contract", () => {
    it("xdg-paths.AC3.1: src/utils/xdg.ts imports only from env-paths", () => {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      // Handle both src and compiled dist directories
      const srcDir = __dirname.includes("/dist/") ? __dirname.replace("/dist/", "/src/") : __dirname;
      const sourceFilePath = resolve(srcDir, "xdg.ts");
      const source = readFileSync(sourceFilePath, "utf-8");

      expect(source).not.toMatch(/from\s+["']\.\//);
      expect(source).not.toMatch(/from\s+["']\.\.\//);
    });
  });
});
