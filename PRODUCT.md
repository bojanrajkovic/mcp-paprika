# Product

> **Scope.** This is the whole-product strategic register for **mcp-paprika**. The product's "frontend" is mostly the LLM-mediated tool surface; the only _traditional_ frontend is two HTML surfaces — the **widget surface** (tappable, in-host, themed) and the **OAuth consent screen** (the first-connect trust moment). The companion `DESIGN.md` is the _visual_ system, scoped to those two surfaces.

## Register

product

## Users

- **Primary — the person behind the agent.** A non-technical home cook driving an LLM agent, usually on mobile, mid-task: standing in a store, working at a stove. They never see the tool surface directly — they see the agent's words and, where a tap beats a sentence, a widget they can act on (check off a grocery item, mark a pantry item out of stock). Their job is to get a cooking/shopping task done without narrating every step.
- **Proximate — the agent.** The LLM is the immediate consumer of the tool surface, and **first-try tool selection is the metric that governs reliability** — the tool's _name_, not its prose, is the load-bearing signal. So the surface is shaped as a **small, regular command language**: a consistent CRUD core (`create` / `add` / `list` / `read` / `update` / `delete` in `verb_entity` order) the agent generalizes an unseen tool from, plus a short, governed bench of **intent verbs** for the acts a human actually names. A verb earns a place on that bench only when a human names the act — it crosses entities, names a state transition a bare `update` would erase, or matches high-frequency user phrasing — so "we're out of milk" or "trash this recipe" maps to a tool whose name _is_ that intent, and the agent matches semantics instead of inferring which field on which `update_` tool to set. The human reads clean Markdown; the model reads a parallel structured channel carrying the identifiers, so it drives the next call without scraping UIDs out of prose. Optimizing the tool surface for the agent's reliability is optimizing the product.
- **Second human surface — the operator/connector at first connect.** Someone approving an OAuth redirect when a client connects to the self-hosted HTTP deployment — a one-time trust moment, often on desktop. Their job is a single decision: "did I start this connection, and where is the authorization code being sent?" The consent screen exists to make that legible and calm.

## Product Purpose

mcp-paprika bridges a Paprika recipe library — recipes, the pantry, grocery lists, meal planning, menus — to MCP clients. Its bet is that **the LLM is a better UX than a hand-built one**, so the product invests in shaping the agent's experience: a command-language tool surface, clean Markdown for the human alongside a structured channel for the model, tap-native widgets where interaction beats prose, and spec-native confirmations for destructive acts.

Two surfaces are _traditional_ frontend and earn a visual design: the **widget surface** (a `ui://` resource rendered in the host's sandboxed iframe — themed, viewport-aware, action-bearing; additive and degrading to text) and the **OAuth consent screen** (server-rendered, security-first, the pre-connection trust moment). Success: the human rarely has to narrate what a tap could do, and never hesitates — or panics — at the trust moment.

## Brand Personality

- **Identity: the Paprika MCP Connector.** The product is a _connector_ to the Paprika recipe app, and its surface identity nods to that without claiming the app's brand — a paprika-red (`#C0392B`) tile with a bold "P" (the connector icon, the favicon, the consent accent). Paprika-red is the connector's one identity color; the name "Paprika" is the app it bridges, not a brand the connector owns.
- **Three words: warm, homey, editorial.** The feel of a well-run kitchen — competent, unhurried, trustworthy — but _restrained and authoritative_, never cutesy.
- **Reference: NYT Cooking.** Warm and food-forward, yet editorial: generous space, confident typography, an authority you trust on sight. That warmth-with-restraint is the target — not a bubbly consumer-recipe blog.
- **Emotional goal.** The calm of a capable kitchen. The widget disappears into the task; the consent screen feels legible and reassuring, not alarming. A green checkmark is satisfying; a trust decision is clear.

## Anti-references

- **Generic AI/SaaS dashboard slop.** Gradient text, tracked-uppercase eyebrows over every section, identical icon-card grids, glassmorphism, hero-metric templates.
- **Enterprise/admin-console heaviness.** Gray-on-gray chrome, heavy borders, table-everything density where a calm list belongs.
- **Cutesy consumer recipe app / food blog.** Over-illustrated, bubbly-rounded everything, emoji-heavy, playful display fonts in UI labels. _NYT Cooking, not a cutesy food blog._
- **Scary security-theater (the consent screen).** Red warning banners, fear copy, phishy urgency. The redirect-approval earns trust by being legible and calm — anchoring on the un-forgeable destination host and stating the grant plainly — never by shouting.

## Design Principles

1. **The tool disappears into the task.** Every surface optimizes for the human's moment — a tap in a store, a yes/no at the stove, a trust decision at connect — not for showing off.
2. **The LLM is the primary UX; visual surfaces are additive.** Widgets and structured output augment the agent and degrade to text; they are never required. Build for the agent first, the eye second.
3. **Earned familiarity, not novelty.** The surfaces should feel like things the user already trusts — NYT Cooking's editorial warmth on the eye, and native mobile conventions in the hand (the swipe-to-act is the iOS-Mail affordance, not an invention). Invent no affordance a standard one already serves.
4. **Honesty at the trust moment.** The consent screen anchors on the one fact an attacker cannot forge (the redirect host) and states the grant plainly; it earns trust by legibility, never by alarm.
5. **Identity is paprika-red; meaning is functional color.** The brand red carries identity; semantic color carries state (a "done"/fresh green, a warning amber, a danger red). Neither is decoration — color always means something.

## Accessibility & Inclusion

- **WCAG AA contrast** (≥4.5:1 body, ≥3:1 large) on both surfaces, in light and dark where the surface themes (the widgets follow the host theme; the consent screen is light-only by design).
- **Reduced motion honored.** The widgets already gate both CSS and JS-driven transitions on `prefers-reduced-motion`; the consent screen is essentially static.
- **Touch-first on the widget surface.** Real tap targets; swipe gestures always have a visible-button fallback on pointer hosts. The swipe-only mobile path's assistive-tech gap is a known widget follow-up.
- **Plain, non-alarmist language at the trust moment.** The destination host is the legible anchor; copy is calm and direct, escaped against injection.
