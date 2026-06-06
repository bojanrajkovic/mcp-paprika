import { describe, expect, it, vi } from "vitest";

import type { RecipeUid } from "../domains/recipe/ids.js";

import { makeRecipe } from "../../test/domains/recipe/__fixtures__/recipes.js";
import { makePinoCapture } from "../../test/support/tool-test-utils.js";
import { createIndexEvents, type IndexEvent } from "./index-events.js";

// ---------------------------------------------------------------------------
// createIndexEvents
// ---------------------------------------------------------------------------

describe("createIndexEvents", () => {
  it("delivers a recipe-changed event with its recipes payload to a subscribed handler", () => {
    const { log } = makePinoCapture();
    const events = createIndexEvents(log);

    const received: IndexEvent[] = [];
    events.on((e) => {
      received.push(e);
    });

    const recipe = makeRecipe({ uid: "r-1" as RecipeUid });
    events.emit({ type: "recipe-changed", recipes: [recipe] });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: "recipe-changed", recipes: [recipe] });
  });

  it("delivers a recipe-removed event with its uids payload", () => {
    const { log } = makePinoCapture();
    const events = createIndexEvents(log);

    const received: IndexEvent[] = [];
    events.on((e) => {
      received.push(e);
    });

    const uids = ["r-1", "r-2"] as RecipeUid[];
    events.emit({ type: "recipe-removed", uids });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: "recipe-removed", uids });
  });

  it("delivers a category-changed event with its uids payload", () => {
    const { log } = makePinoCapture();
    const events = createIndexEvents(log);

    const received: IndexEvent[] = [];
    events.on((e) => {
      received.push(e);
    });

    const uids = ["cat-1", "cat-2"];
    events.emit({ type: "category-changed", uids });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: "category-changed", uids });
  });

  it("delivers an event to all subscribed handlers", () => {
    const { log } = makePinoCapture();
    const events = createIndexEvents(log);

    const handlerA = vi.fn();
    const handlerB = vi.fn();
    const handlerC = vi.fn();

    events.on(handlerA);
    events.on(handlerB);
    events.on(handlerC);

    const recipe = makeRecipe({ uid: "r-multi" as RecipeUid });
    events.emit({ type: "recipe-changed", recipes: [recipe] });

    expect(handlerA).toHaveBeenCalledOnce();
    expect(handlerB).toHaveBeenCalledOnce();
    expect(handlerC).toHaveBeenCalledOnce();

    // All three should have received the same event object
    expect(handlerA).toHaveBeenCalledWith(expect.objectContaining({ type: "recipe-changed" }));
    expect(handlerB).toHaveBeenCalledWith(expect.objectContaining({ type: "recipe-changed" }));
    expect(handlerC).toHaveBeenCalledWith(expect.objectContaining({ type: "recipe-changed" }));
  });

  describe("throwing handler", () => {
    it("does not cause emit() to throw", () => {
      const { log } = makePinoCapture();
      const events = createIndexEvents(log);

      events.on(() => {
        throw new Error("handler kaboom");
      });

      expect(() => {
        events.emit({ type: "recipe-removed", uids: [] as RecipeUid[] });
      }).not.toThrow();
    });

    it("logs the error at warn level", () => {
      const { log, records } = makePinoCapture();
      const events = createIndexEvents(log);

      events.on(() => {
        throw new Error("handler kaboom");
      });

      events.emit({ type: "recipe-removed", uids: [] as RecipeUid[] });

      const warnRecord = records.find((r) => r["level"] === 40); // pino warn = 40
      expect(warnRecord).toBeDefined();
      expect(warnRecord?.["msg"]).toMatch(/ignored/);
    });

    it("does not prevent other handlers from running", () => {
      const { log } = makePinoCapture();
      const events = createIndexEvents(log);

      const good = vi.fn();

      events.on(() => {
        throw new Error("this one throws");
      });
      events.on(good);

      events.emit({ type: "category-changed", uids: ["cat-x"] });

      expect(good).toHaveBeenCalledOnce();
      expect(good).toHaveBeenCalledWith(expect.objectContaining({ type: "category-changed" }));
    });
  });

  describe("unsubscribe", () => {
    it("stops calling the handler after the returned unsubscribe function is invoked", () => {
      const { log } = makePinoCapture();
      const events = createIndexEvents(log);

      const handler = vi.fn();
      const unsubscribe = events.on(handler);

      // Confirm it fires before unsubscribe
      events.emit({ type: "category-changed", uids: [] });
      expect(handler).toHaveBeenCalledTimes(1);

      unsubscribe();

      // Emit again — handler must NOT be called a second time
      events.emit({ type: "category-changed", uids: [] });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("unsubscribing one handler does not affect other handlers", () => {
      const { log } = makePinoCapture();
      const events = createIndexEvents(log);

      const handlerA = vi.fn();
      const handlerB = vi.fn();

      const unsubA = events.on(handlerA);
      events.on(handlerB);

      unsubA();

      events.emit({ type: "recipe-removed", uids: [] as RecipeUid[] });

      expect(handlerA).not.toHaveBeenCalled();
      expect(handlerB).toHaveBeenCalledOnce();
    });
  });
});
