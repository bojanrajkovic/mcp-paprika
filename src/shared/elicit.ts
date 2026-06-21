import type { ClientCapabilities, ElicitRequestFormParams, ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import type { Logger } from "pino";

/**
 * The slice of the session MCP server the elicitation helpers touch: the
 * client-capability read and the form-mode elicitation call. The per-session
 * base `Server` (`ctx.server.server`) satisfies it structurally, and a test
 * passes a two-method stub — so the helpers depend on exactly this surface,
 * not the whole `McpServer` (the same least-privilege narrowing `DomainCtx`
 * applies to domain state). `elicitInput` is declared with the form param only;
 * the real method accepts the wider form|url union, which is assignable here.
 */
export interface ElicitationServer {
  getClientCapabilities(): ClientCapabilities | undefined;
  elicitInput(params: ElicitRequestFormParams): Promise<ElicitResult>;
}

/**
 * Whether the connected client advertised FORM-mode elicitation. Mirrors the
 * exact guard the SDK's `elicitInput` makes before it throws, so a positive
 * answer here means the call below will reach the client rather than throw at
 * the boundary. Read off the per-session server, so under HTTP it reflects the
 * capability of *this* session's client (ADR-0001), not a process-wide value.
 */
export function supportsForm(server: ElicitationServer): boolean {
  return server.getClientCapabilities()?.elicitation?.form !== undefined;
}

/** The outcome of a {@link confirmGate}: act, abort, or the gate never ran. */
export type ConfirmOutcome = "proceed" | "declined" | "unsupported";

/**
 * Ask the human to confirm a high-cost act before it happens (ADR-0020 R3).
 * Returns `proceed` on accept, `declined` on decline/cancel (the user said no —
 * a normal outcome the caller renders as "Cancelled", never an error), and
 * `unsupported` when the client cannot be asked OR the request errors.
 *
 * The capability is checked before issuing the request, and any throw — an
 * unsupported client slipping past the check, a transport failure, the SDK's
 * own response-validation error — is caught and mapped to `unsupported`, so a
 * raw SDK throw never crosses into the neverthrow core (ADR-0014). Both
 * non-answer paths collapse to `unsupported` by design: the gate is fail-open
 * (ADR-0020), so a caller treats `unsupported` the same as `proceed`, with the
 * host's own tool-approval prompt as the backstop. A pure confirm carries no
 * fields, so the requested schema is an empty object and only `action` is read.
 */
export async function confirmGate(
  server: ElicitationServer,
  opts: { readonly message: string; readonly log?: Logger },
): Promise<ConfirmOutcome> {
  if (!supportsForm(server)) return "unsupported";
  try {
    const result = await server.elicitInput({
      message: opts.message,
      requestedSchema: { type: "object", properties: {} },
    });
    return result.action === "accept" ? "proceed" : "declined";
  } catch (err) {
    opts.log?.debug({ err }, "confirm elicitation failed; proceeding fail-open");
    return "unsupported";
  }
}

/** The outcome of a {@link pickOne}: the chosen item, abort, or the gate never ran. */
export type PickOutcome<T> = { readonly chosen: T } | "declined" | "unsupported";

/**
 * Ask the human to pick one of several matches (ADR-0020 R3 — the short-PICK
 * the fuzzy-lookup `text_many` path becomes). Returns the `chosen` item on
 * accept, `declined` on decline/cancel, and `unsupported` when the client
 * cannot be asked, the request errors, or the returned choice is off-list — so
 * the caller falls back to its disambiguation prose in every non-pick case.
 *
 * Candidates render as an enum over their opaque UIDs with the human-readable
 * labels carried in `enumNames`; the accepted `choice` is one of those UIDs,
 * mapped back to its item. Keeping the pick SHORT (a candidate cap) is the
 * caller's policy — this helper renders whatever it is given, and treats an
 * empty candidate set as nothing-to-pick (`unsupported`).
 */
export async function pickOne<T>(
  server: ElicitationServer,
  opts: {
    readonly message: string;
    readonly candidates: ReadonlyArray<T>;
    readonly describe: (item: T) => { readonly uid: string; readonly label: string };
    readonly log?: Logger;
  },
): Promise<PickOutcome<T>> {
  if (opts.candidates.length === 0 || !supportsForm(server)) return "unsupported";
  const described = opts.candidates.map((item) => ({ item, ...opts.describe(item) }));
  try {
    const result = await server.elicitInput({
      message: opts.message,
      requestedSchema: {
        type: "object",
        properties: {
          choice: {
            type: "string",
            enum: described.map((d) => d.uid),
            enumNames: described.map((d) => d.label),
          },
        },
        required: ["choice"],
      },
    });
    if (result.action !== "accept") return "declined";
    const hit = described.find((d) => d.uid === result.content?.["choice"]);
    return hit ? { chosen: hit.item } : "unsupported";
  } catch (err) {
    opts.log?.debug({ err }, "pick elicitation failed; falling back");
    return "unsupported";
  }
}
