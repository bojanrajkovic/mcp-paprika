import { afterEach, describe, expect, it, vi } from "vitest";

// A controllable stand-in for `document.startViewTransition`: each call returns a transition whose
// `finished` promise the test settles by hand.
function stubDocument() {
  const dataset: Record<string, string> = {};
  const finishers: (() => void)[] = [];
  const doc = {
    documentElement: { dataset },
    startViewTransition: (cb: () => Promise<void> | void) => {
      void cb();
      return {
        finished: new Promise<void>((resolve) => {
          finishers.push(resolve);
        }),
      };
    },
  };
  vi.stubGlobal("document", doc);
  return { dataset, finishers };
}

describe("viewTransition", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("keeps the direction attribute while a newer transition for the same key is running", async () => {
    const { dataset, finishers } = stubDocument();
    const { viewTransition } = await import("./view-transition.js");

    viewTransition(() => {}, ["cookVt", "fwd"]);
    viewTransition(() => {}, ["cookVt", "back"]);
    expect(dataset["cookVt"]).toBe("back");

    finishers[0]!(); // the skipped first transition settles mid-way through the second
    await Promise.resolve();
    expect(dataset["cookVt"]).toBe("back");

    finishers[1]!();
    await Promise.resolve();
    expect(dataset["cookVt"]).toBeUndefined();
  });

  it("runs the mutation inline when the API is missing", async () => {
    vi.stubGlobal("document", { documentElement: { dataset: {} } });
    const { viewTransition } = await import("./view-transition.js");
    const mutate = vi.fn();
    viewTransition(mutate, ["cookVt", "fwd"]);
    expect(mutate).toHaveBeenCalledOnce();
  });
});
