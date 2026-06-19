import type { ClientCapabilities, ElicitRequestFormParams, ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";

import type { ElicitationServer } from "./elicit.js";

import { confirmGate, pickOne } from "./elicit.js";

/**
 * A stub {@link ElicitationServer}: `capabilities` controls what the client is
 * deemed to support, `respond` produces the client's answer (or throws to model
 * a transport/validation failure), and `calls` records the requests so a test
 * can assert the gate stayed silent when it should have.
 */
function makeServer(opts: {
  readonly capabilities?: ClientCapabilities;
  readonly respond?: (params: ElicitRequestFormParams) => ElicitResult | Promise<ElicitResult>;
}): ElicitationServer & { readonly calls: ElicitRequestFormParams[] } {
  const calls: ElicitRequestFormParams[] = [];
  return {
    calls,
    getClientCapabilities() {
      return opts.capabilities;
    },
    async elicitInput(params) {
      calls.push(params);
      if (!opts.respond) throw new Error("no responder configured");
      return opts.respond(params);
    },
  };
}

const FORM_CAPABLE = { elicitation: { form: {} } } as unknown as ClientCapabilities;
const ELICIT_NO_FORM = { elicitation: {} } as unknown as ClientCapabilities;

describe("confirmGate", () => {
  it("returns unsupported without asking when the client advertises no elicitation", async () => {
    const server = makeServer({});
    expect(await confirmGate(server, { message: "Delete?" })).toBe("unsupported");
    expect(server.calls).toHaveLength(0);
  });

  it("returns unsupported without asking when elicitation lacks form mode", async () => {
    const server = makeServer({ capabilities: ELICIT_NO_FORM });
    expect(await confirmGate(server, { message: "Delete?" })).toBe("unsupported");
    expect(server.calls).toHaveLength(0);
  });

  it("returns proceed on accept, sending the message and an empty requested schema", async () => {
    const server = makeServer({ capabilities: FORM_CAPABLE, respond: () => ({ action: "accept" }) });
    expect(await confirmGate(server, { message: "Permanently delete X?" })).toBe("proceed");
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0]!.message).toBe("Permanently delete X?");
    expect(server.calls[0]!.requestedSchema.properties).toEqual({});
  });

  it("returns declined on decline", async () => {
    const server = makeServer({ capabilities: FORM_CAPABLE, respond: () => ({ action: "decline" }) });
    expect(await confirmGate(server, { message: "Delete?" })).toBe("declined");
  });

  it("returns declined on cancel (a dismissal is still a no)", async () => {
    const server = makeServer({ capabilities: FORM_CAPABLE, respond: () => ({ action: "cancel" }) });
    expect(await confirmGate(server, { message: "Delete?" })).toBe("declined");
  });

  it("returns unsupported (fail-open) when the elicitation request throws", async () => {
    const server = makeServer({
      capabilities: FORM_CAPABLE,
      respond: () => {
        throw new Error("transport gone");
      },
    });
    expect(await confirmGate(server, { message: "Delete?" })).toBe("unsupported");
    expect(server.calls).toHaveLength(1);
  });
});

interface Match {
  readonly uid: string;
  readonly name: string;
}
const MATCHES: ReadonlyArray<Match> = [
  { uid: "uid-a", name: "Apple Pie" },
  { uid: "uid-b", name: "Banana Bread" },
  { uid: "uid-c", name: "Cherry Tart" },
];
const describeMatch = (m: Match) => ({ uid: m.uid, label: m.name });

describe("pickOne", () => {
  it("returns unsupported without asking when the client cannot be elicited", async () => {
    const server = makeServer({ capabilities: ELICIT_NO_FORM });
    expect(await pickOne(server, { message: "Which?", candidates: MATCHES, describe: describeMatch })).toBe(
      "unsupported",
    );
    expect(server.calls).toHaveLength(0);
  });

  it("returns unsupported for an empty candidate set without asking", async () => {
    const server = makeServer({ capabilities: FORM_CAPABLE });
    expect(await pickOne(server, { message: "Which?", candidates: [], describe: describeMatch })).toBe("unsupported");
    expect(server.calls).toHaveLength(0);
  });

  it("returns the chosen item on accept, rendering uids as the enum and labels as enumNames", async () => {
    const server = makeServer({
      capabilities: FORM_CAPABLE,
      respond: () => ({ action: "accept", content: { choice: "uid-b" } }),
    });
    const outcome = await pickOne(server, { message: "Which recipe?", candidates: MATCHES, describe: describeMatch });
    expect(outcome).toEqual({ chosen: MATCHES[1] });

    const choice = server.calls[0]!.requestedSchema.properties["choice"] as {
      enum: string[];
      enumNames: string[];
    };
    expect(choice.enum).toEqual(["uid-a", "uid-b", "uid-c"]);
    expect(choice.enumNames).toEqual(["Apple Pie", "Banana Bread", "Cherry Tart"]);
  });

  it("returns declined on decline", async () => {
    const server = makeServer({ capabilities: FORM_CAPABLE, respond: () => ({ action: "decline" }) });
    expect(await pickOne(server, { message: "Which?", candidates: MATCHES, describe: describeMatch })).toBe("declined");
  });

  it("returns unsupported when the accepted choice is not one of the candidates", async () => {
    const server = makeServer({
      capabilities: FORM_CAPABLE,
      respond: () => ({ action: "accept", content: { choice: "uid-zzz" } }),
    });
    expect(await pickOne(server, { message: "Which?", candidates: MATCHES, describe: describeMatch })).toBe(
      "unsupported",
    );
  });

  it("returns unsupported (fail-open) when the elicitation request throws", async () => {
    const server = makeServer({
      capabilities: FORM_CAPABLE,
      respond: () => {
        throw new Error("transport gone");
      },
    });
    expect(await pickOne(server, { message: "Which?", candidates: MATCHES, describe: describeMatch })).toBe(
      "unsupported",
    );
  });
});
