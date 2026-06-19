import { isAbsolute, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useTempDir } from "../../../test/support/disk-caches.js";
import { SILENT_LOG } from "../../utils/log.js";
import { loadWidgetArtifacts, widgetsDir } from "./artifacts.js";

describe("widgetsDir", () => {
  it("resolves to an absolute dist/widgets path", () => {
    const dir = widgetsDir();
    expect(isAbsolute(dir)).toBe(true);
    expect(dir.endsWith(join("dist", "widgets"))).toBe(true);
  });
});

describe("loadWidgetArtifacts", () => {
  const tmp = useTempDir("mcp-paprika-widget-artifacts-");

  beforeEach(async () => {
    await tmp.setup();
  });
  afterEach(async () => {
    await tmp.teardown();
  });

  it("loads each .html file into a name → html map", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(tmp.dir(), "demo.html"), "<html>demo</html>", "utf8");
    await writeFile(join(tmp.dir(), "grocery.html"), "<html>grocery</html>", "utf8");
    // A non-.html file is ignored.
    await writeFile(join(tmp.dir(), "notes.txt"), "ignore me", "utf8");

    const map = await loadWidgetArtifacts(tmp.dir(), SILENT_LOG);
    expect([...map.keys()].sort()).toEqual(["demo", "grocery"]);
    expect(map.get("demo")).toBe("<html>demo</html>");
  });

  it("degrades to an empty map when the directory is missing (no throw)", async () => {
    const map = await loadWidgetArtifacts(join(tmp.dir(), "does-not-exist"), SILENT_LOG);
    expect(map.size).toBe(0);
  });

  it("degrades to an empty map when the directory holds no widgets", async () => {
    const map = await loadWidgetArtifacts(tmp.dir(), SILENT_LOG);
    expect(map.size).toBe(0);
  });
});
