# ADR-NNNN: <short imperative title of the decision>

> Record an ADR only for a **decision with weighed alternatives**: a fork where a different reasonable engineer could have chosen otherwise, and the choice has lasting architectural consequences. Do **not** write an ADR for an implementation detail, a forced necessity (something the platform or a hard dependency left no choice about), or a workaround. Those belong in code comments or `docs/architecture.md`.

**Status:** Proposed | Accepted (YYYY-MM-DD) | Superseded by ADR-NNNN | Deprecated

<!--
Copy this file to docs/adr/NNNN-<kebab-title>.md, using the next free zero-padded
number. Fill every section. Delete the HTML comments and the angle-bracket
prompts as you go. Keep prose conceptual: describe shape and reasoning, not code.
-->

## Context

<!--
WHAT GOES HERE: the situation and constraints that were true at decision time:
the forces in tension (correctness, latency, the Paprika API's shape, MCP wire
constraints, operational limits) and what made a choice necessary. Write it so a
reader a year from now understands the pressure without reading the diff.

RATIONALIZATION TO RESIST: turning this into a changelog ("first we tried X, then
we switched to Y"). State what was *true*, not the journey to it.

WRONG CONTENT GOES INSTEAD: narrative of the work and the exploration belongs with
the implementation and its tests, not the ADR.
-->

## Decision

<!--
WHAT GOES HERE: the option chosen, stated as a present-tense fact, with
components named by their ROLE or LIBRARY (e.g. "the in-memory recipe store
hydrates from the per-entity disk cache", "validation happens at the tool
boundary via zod"). One paragraph on the choice, one on why it beat the field.

RATIONALIZATION TO RESIST: "the reader will want to see exactly how it works, so
I'll paste the type / function signature / config struct here." You will be
tempted to make the ADR authoritative by reproducing source. Don't. Source
drifts and the ADR becomes a lie. An ADR captures the *decision*, not the API.

WRONG CONTENT GOES INSTEAD: signatures, struct/type dumps, schemas, env-var
tables, and tool/store enumerations belong in the source itself (which is the
single source of truth) and in the generated/reference docs under docs/. Name
the component; do not transcribe it.
-->

## Rejected alternatives

<!--
WHAT GOES HERE: one subsection per option that was genuinely on the table, each
ending with the single trade-off that decided against it. The trade-off is the
load-bearing part: a concrete "rejected because it would have X," not a vibe.

RATIONALIZATION TO RESIST: inventing plausible-sounding alternatives to make the
ADR look thorough. If the plan or source did not record what was actually
weighed, you do NOT know it, and a fabricated alternative is worse than an
absent one: it manufactures false history. NEVER invent alternatives.

IF NOTHING WAS RECORDED: write this section's body as EXACTLY the following line,
verbatim, and add the item to notesForOwner so the owner can backfill it:

_Not recorded at decision time — needs owner input._
-->

### <Alternative A: named by its approach>

Rejected because <the one deciding trade-off>.

### <Alternative B: named by its approach>

Rejected because <the one deciding trade-off>.

## Consequences

<!--
WHAT GOES HERE: what this decision makes easier AND what it makes harder. Both
halves are mandatory. List the new constraints the codebase now lives under, the
maintenance the choice incurs, and the affordances it unlocks.

RATIONALIZATION TO RESIST: writing only the upside. A consequences section with
no negatives is a sales pitch, not a record. Every real decision costs
something; name the cost.
-->

**Positive**

- <what the decision enables or simplifies>

**Negative**

- <the cost, constraint, or future hazard the decision introduces>

## References

<!--
WHAT GOES HERE: related ADRs BY NUMBER (e.g. "Supersedes ADR-0003"), issue/PR
numbers, and external specs (RFCs, the MCP spec, library docs).

RATIONALIZATION TO RESIST: pointing at "the code" with a file:line citation to
prove a claim. Line numbers drift the moment anyone edits the file, and a
citation that no longer resolves is worse than none. Cite a file PATH at most,
and only when the path itself is the reference; never cite line numbers.
-->

- Related: ADR-NNNN
- Issue/PR: #NNN
- External: <spec or library doc URL>
