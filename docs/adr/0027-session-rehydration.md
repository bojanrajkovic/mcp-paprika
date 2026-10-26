# ADR-0027: Rebuild HTTP sessions from disk after a restart

**Status:** Accepted (2026-10-25)

## Context

The HTTP transport keeps live sessions in memory. A restart (a deploy, a pod reschedule) empties that map, so the next request carrying a previously issued `mcp-session-id` finds nothing. The Streamable HTTP spec's answer is a `404`, which tells the client to drop the id and send a new `initialize`.

Not every client does that. The claude.ai web connector keeps re-sending the dead id after a restart and never re-initializes, which surfaces to the user as "Couldn't reload tools from server" until they remove and re-add the connector. The server can't fix the client, but it can avoid presenting the `404` in the first place.

Two facts make that cheap. A session holds no durable state of its own: `registerAll` registers closures over process-wide state that's already warm from the disk cache. What a restart actually loses is the session id's validity and the capabilities the client declared at `initialize`, which the elicitation gates read per session ([ADR-0020](0020-fail-open-elicitation-gates.md)). And the server runs as a single instance, so local disk is the whole world.

## Decision

The transport persists a small record per session under `<cache dir>/sessions/` and, when a request arrives for an id that isn't live but has a record, rebuilds the session under that same id and serves the request.

The record holds the protocol version, the client's declared identity and capabilities, the OAuth subject that opened the session, and two timestamps. It's written at `initialize`, before the response goes out, because a restart right after connecting is the case this exists for. A rebuild builds a fresh server and transport whose id generator is pinned to the requested id, then drives a synthetic `initialize` and `notifications/initialized` through the transport in-process. That's the same code path a real client takes, so the transport assigns the id and the server restores the client's capabilities without forking `@hono/mcp`. The synthetic requests carry the real request's `Host` and `Origin`, so DNS rebinding protection applies to them unchanged.

Rebuilding fails closed. The id must be UUID-shaped before it touches the disk (it becomes a file path). A record unused for seven days is expired and pruned; a session in use refreshes its record at most hourly, so the clock counts from last use, not from creation. A request whose subject differs from the record's gets the same `404` as an unknown id, and the record stays, so a stranger presenting someone's id learns nothing and can't evict it. The same subject rule applies to live sessions. An unparseable record or a failed synthetic `initialize` is an unknown session, never a `500`. Concurrent requests for the same id and subject share one rebuild. A client `DELETE` removes the record; the shutdown drain keeps records, since surviving that restart is the point.

The store holds at most 500 records. Every reconnect mints a new id and clients never return for abandoned ones, so expired records are swept at boot and again when the cap is reached (at most hourly, so a cap full of live records doesn't cost a sweep per connect); only a full set of live records within the TTL stops a new session from persisting, and then that session simply won't survive a restart.

This beat the field because it removes the dependency on client `404` handling for the common restart case with no new service, no library fork, and no change to how tools are registered.

## Rejected alternatives

### Stateless mode (no sessions)

Rejected because server-initiated elicitation needs a stateful transport to carry a request to the client mid-call, and the elicitation gates depend on it.

### A shared session store (Redis, Valkey)

Rejected because the server is single-instance. A network store adds credentials, another service, and another failure mode to solve a restart on one machine. Going multi-instance would reopen this with sticky routing or a shared store.

### Rely on the conformant `404` alone

Rejected because it leaves the restart experience to each client's `404` handling, which is exactly what fails on the claude.ai connector.

### Configurable TTL and an on/off switch

Rejected because both are read once at boot, so changing either already means a restart, the same as changing a constant. Two env vars would add surface to document and test for knobs nobody had a reason to turn.

### A size cap on persisted capabilities

Rejected because only an allowlisted, authenticated subject can open a session, so an oversized record means a buggy client of the deployment's own user. The 500-record cap and the TTL already bound the damage. A cap, or keeping only known capability fields, would add a check whose failure mode (a new spec capability silently not surviving a restart) is worse than the risk.

## Consequences

**Positive**

- A client holding a recently used session id keeps working across a restart with no error and no re-initialize, whatever its `404` handling.
- Elicitation keeps working on a rebuilt session, because the synthetic `initialize` restores the declared capabilities.
- A session id is bound to its subject on every path, live or rebuilt, so a leaked id is useless without its owner's token.

**Negative**

- An elicitation in flight at the moment of a restart is still lost: the pending server-to-client request lived only in memory. The session comes back; that one call fails and the caller retries.
- Session records outlive their sessions on disk, until the TTL or the cap removes them. They hold identifiers (the OAuth subject, client name and version), never tokens.
- One more disk-backed store to reason about alongside the OAuth and entity caches, though it reuses the same `DiskCache` primitive and cap pattern.

## References

- Related: [ADR-0020](0020-fail-open-elicitation-gates.md) (the elicitation gates whose capability this restores), [ADR-0024](0024-client-connection-fingerprint.md) (the fingerprint a rebuild re-records)
- Source: `src/transport/session-store.ts`, `src/transport/session-rehydration.ts`, `src/auth/subject.ts`
- External: [MCP Streamable HTTP transport, session management](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#session-management)
