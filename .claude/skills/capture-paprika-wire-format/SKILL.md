---
name: capture-paprika-wire-format
description: Use when reverse-engineering an undocumented Paprika API endpoint — orchestrates mitmproxy capture via PAC proxy, drives Paprika.app UI with computer-use MCP, decodes and sanitizes traffic, converts to HAR 1.2, and generates typed TypeScript fixture modules. Triggers on "capture wire format", "reverse-engineer the API for", "wire capture for [entity]".
---

# Capture Paprika Wire Format

## Overview

End-to-end pipeline for capturing Paprika Cloud Sync API wire format via mitmproxy interception of the macOS desktop client. Produces sanitized HAR 1.2 files with named entries and strongly-typed TypeScript fixture modules for tests.

## When to Use

- Reverse-engineering an undocumented Paprika API surface (e.g., bookmarks, pantry locations, custom meal types)
- Verifying wire format assumptions before implementing a new entity type
- Updating existing captures after Paprika app updates change the wire format
- A GitHub issue's DoD includes "capture wire format" or "decoded bodies pasted as comments"

## Prerequisites Check

**Run these checks before starting. Offer to install anything missing.**

```bash
# 1. mitmproxy
if command -v mitmdump &>/dev/null; then
  echo "✓ mitmdump $(mitmdump --version 2>&1 | head -1)"
else
  echo "✗ mitmdump not found — install with: brew install mitmproxy"
  # Offer: "Should I run brew install mitmproxy?"
fi

# 2. mitmproxy CA cert
if [ -f ~/.mitmproxy/mitmproxy-ca-cert.pem ]; then
  echo "✓ mitmproxy CA cert exists"
  # Verify it's trusted (security find-certificate returns 0 if found)
  security find-certificate -c "mitmproxy" /Library/Keychains/System.keychain &>/dev/null \
    && echo "✓ CA cert is trusted" \
    || echo "✗ CA cert not trusted — run: sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/.mitmproxy/mitmproxy-ca-cert.pem"
else
  echo "✗ CA cert missing — run mitmdump once to generate it, then trust it"
fi

# 3. Paprika app
if [ -d "/Applications/Paprika Recipe Manager 3.app" ]; then
  echo "✓ Paprika Recipe Manager 3 installed"
else
  echo "✗ Paprika Recipe Manager 3 not found in /Applications"
fi

# 4. Network service (find the active one — not always "Wi-Fi")
NETWORK_SERVICE=$(networksetup -listallnetworkservices | grep -v '^\*' | while read svc; do
  networksetup -getinfo "$svc" 2>/dev/null | grep -q "IP address: [0-9]" && echo "$svc" && break
done)
echo "Active network service: ${NETWORK_SERVICE:-UNKNOWN}"

# 5. Paprika credentials
ENV_FILE="$(python3 -c "
import os, json
# Check XDG config, then macOS default
for base in [os.environ.get('XDG_CONFIG_HOME', ''), os.path.expanduser('~/Library/Preferences')]:
  p = os.path.join(base, 'mcp-paprika', '.env')
  if os.path.isfile(p):
    print(p)
    break
" 2>/dev/null)"
if [ -n "$ENV_FILE" ]; then
  echo "✓ Credentials at: $ENV_FILE"
  grep -qc 'PAPRIKA_EMAIL' "$ENV_FILE" && echo "  ✓ PAPRIKA_EMAIL present" || echo "  ✗ PAPRIKA_EMAIL missing"
  grep -qc 'PAPRIKA_PASSWORD' "$ENV_FILE" && echo "  ✓ PAPRIKA_PASSWORD present" || echo "  ✗ PAPRIKA_PASSWORD missing"
else
  echo "✗ No .env found — check XDG_CONFIG_HOME/mcp-paprika/.env or $ENV_FILE"
fi

# 6. computer-use MCP (can't check programmatically — just note it)
echo "? computer-use MCP: verify it's available (call mcp__computer-use__list_granted_applications)"
```

**If any check fails, resolve it before proceeding. Offer to run install commands for the user.**

## Variables Set by Prerequisites

The prerequisites check discovers two system-specific values used throughout:

- `$NETWORK_SERVICE` — active macOS network service (e.g., "Wi-Fi", "Ethernet", "USB 10/100/1000 LAN")
- `$ENV_FILE` — path to the Paprika credentials `.env` file (XDG or macOS Preferences)

## Input

The user provides:

1. **Target entity** — what API surface to capture (e.g., "bookmarks", "pantry locations")
2. **Capture plan** — ordered list of UI operations to perform (create, edit, delete, etc.)
3. **HAR filename** — e.g., `bookmarks.har.json` (saved to `docs/wire-captures/`)

## Pipeline

### Phase 1: Setup

1. **Create session scratch directory:**

   ```bash
   mkdir -p /tmp/claude-<session-id>/
   ```

2. **Create PAC file** (proxies ONLY paprikaapp.com traffic):

   ```bash
   mkdir -p /tmp/claude-<session-id>/pac/
   cat > /tmp/claude-<session-id>/pac/proxy.pac <<'EOF'
   function FindProxyForURL(url, host) {
       if (shExpMatch(host, "*.paprikaapp.com") || host === "paprikaapp.com") {
           return "PROXY 127.0.0.1:8888";
       }
       return "DIRECT";
   }
   EOF
   ```

3. **Start PAC server + mitmdump:**

   ```bash
   python3 -m http.server 8889 --directory /tmp/claude-<session-id>/pac &>/dev/null &
   mitmdump --listen-port 8888 \
     --save-stream-file /tmp/claude-<session-id>/<entity>-capture.mitm \
     --set 'flow_detail=2' \
     --allow-hosts 'paprikaapp\.com' \
     > /tmp/claude-<session-id>/mitmdump.log 2>&1 &
   ```

4. **Enable PAC proxy:**

   ```bash
   networksetup -setautoproxyurl "$NETWORK_SERVICE" "http://127.0.0.1:8889/proxy.pac"
   networksetup -setautoproxystate "$NETWORK_SERVICE" on
   ```

5. **Request computer-use access:**
   ```
   mcp__computer-use__request_access(
     apps: ["Paprika Recipe Manager 3"],
     reason: "Drive Paprika UI to capture <entity> wire format",
     clipboardRead: true,
     clipboardWrite: true
   )
   ```

### Phase 2: Smoke Test

Before the full capture, verify the pipeline works:

1. Open Paprika via `mcp__computer-use__open_application`
2. Wait 3 seconds for startup sync
3. Check mitmdump captured traffic: `ls -la /tmp/claude-<session-id>/<entity>-capture.mitm`
4. If file size is 0: Paprika may cache proxy config at launch — restart the app
5. Decode and verify: `mitmdump -nr <file> -s scripts/decode-capture.py 2>/dev/null | head -20`

**If TLS handshake fails:** Paprika cert-pins against its backend. This has NOT been observed as of May 2026 (Paprika v3.8.4), but if it happens, the capture approach won't work.

### Phase 3: Capture

1. **Navigate to the target section** in Paprika (Recipes, Browser, Groceries, Pantry, Meals, Menus — visible in the sidebar)
2. **Prefix all test entities with `[mcp-cap]`** so they're identifiable in captures and easy to clean up
3. **Execute the capture plan operations** via computer-use, pausing 1-2 seconds between operations for sync
4. **For each operation, note the comment name** you'll assign in the HAR (e.g., "create bookmark for [mcp-cap] recipe")

**UI navigation reference:** Fetch https://www.paprikaapp.com/help/mac/ via WebFetch if you need to find buttons, menus, or keyboard shortcuts.

**Key UI patterns observed:**

- "+" button in toolbar → dropdown with "Add Recipe" / "Add Note" / "Add Menu"
- Right-click items → context menu with Edit, Delete, Type, Day, etc.
- Double-click items → inline edit popover
- "Edit" button on entity views → name/description/settings form
- Recipe picker: click to select, then "Choose" button (don't batch these clicks — the list scrolls)
- Confirmation dialogs ("Are you sure?") require clicking the red "Delete" button

### Phase 4: Teardown

1. **Stop mitmdump and proxy:**

   ```bash
   pkill -f "mitmdump.*<entity>-capture"
   networksetup -setautoproxystate "$NETWORK_SERVICE" off
   pkill -f "python3.*http.server.*8889"
   ```

2. **Verify capture:**
   ```bash
   mitmdump -nr /tmp/claude-<session-id>/<entity>-capture.mitm \
     -s scripts/decode-capture.py 2>/dev/null | \
     grep -oP '"url": "[^"]*"' | sort | uniq -c | sort -rn
   ```

### Phase 5: Decode and Sanitize

1. **Decode** using the project's decode script:

   ```bash
   mitmdump -nr <capture.mitm> -s scripts/decode-capture.py 2>/dev/null
   ```

2. **Filter** to relevant endpoints (drop `/sync/status/` and `/sync/notify/` noise)

3. **Sanitize credentials.** Strip these fields (from `src/utils/log.ts` REDACT_PATHS):
   - `authorization` headers → `[REDACTED]`
   - JWT tokens (pattern: `eyJ...`) → `[REDACTED_JWT]`
   - Email addresses → `[REDACTED_EMAIL]`
   - `password`, `token`, `client_secret`, `access_token`, `refresh_token`, `id_token`

4. **Verify no credentials leaked:**
   ```bash
   grep -riE "(eyJ[A-Za-z0-9_-]{10,}|bearer |brajkov|coderinserepeat|password)" <output>
   ```
   This MUST return empty. If not, the output is not safe.

### Phase 6: Convert to HAR

Convert sanitized entries to HAR 1.2 format:

- Each entry gets a descriptive `comment` field (the name)
- Request body goes in `entry.request.postData.text` as JSON string
- Response body goes in `entry.response.content.text` as JSON string
- Authorization header value set to `[REDACTED]`
- Save to `docs/wire-captures/<entity>.har.json`

**CRITICAL: preserve native JSON types from the decoder output VERBATIM.** Do NOT reformat any values during HAR construction:

- Integers stay integers — do NOT convert seconds-since-midnight (`28800`) to time strings (`"08:00:00"`), Unix timestamps to ISO dates, or numeric IDs to padded strings.
- Strings stay strings — do NOT normalize date formats, casing, or whitespace.
- Nulls stay nulls — do NOT substitute empty strings, empty arrays, or omit the field.
- Field order may differ from the source (JSON has no canonical order), but every key-value pair must round-trip byte-equivalently under `JSON.parse(JSON.stringify(...))`.

The HAR is supposed to be a **faithful wire recording**. Any "helpful" reformatting silently corrupts the ground truth that schemas, tests, and drift detection rely on. If you find yourself thinking "this would be more readable as X" — stop. Preserve the wire shape.

A subtle failure mode: when an LLM (you) constructs the HAR body string by hand, it's easy to accidentally quote numbers that look semantically like times, IDs, or dates. Mechanically copy values from the decoder JSON output; don't paraphrase.

Verify after writing the HAR: `python3 -c "import json; har = json.load(open('docs/wire-captures/<file>.har.json')); print(json.loads(har['log']['entries'][0]['response']['content']['text']))"` — eyeball the types against the decoder output.

**Comment naming convention:**

- `create <entity> (<name>)` — for creation
- `add <child>: <type> <recipe> (<details>)` — for adding items
- `edit <entity>: <what changed>` — for updates
- `delete <entity> (soft-delete)` — for deletions
- `cascade delete <children> after <parent> deletion` — for cascading deletes

**Comments must be unique within a HAR file** — the codegen keys fixtures by comment.

### Phase 7: Generate Typed Fixtures

```bash
pnpm generate:fixtures
```

This reads all `docs/wire-captures/*.har.json` and generates TypeScript modules in `src/__fixtures__/wire-captures/` with:

- `FixtureKey` — literal union type of all comments (compile-time safe access)
- `fixture(key)` — returns parsed request/response body by comment name
- `handlers` — MSW HttpHandler array via `@msw/source/traffic`

### Phase 8: Validate

```bash
pnpm typecheck && pnpm lint && pnpm test
```

All three must pass before the capture is considered complete.

### Phase 9: Clean Up Test Data

Delete all `[mcp-cap]` entities from Paprika via the UI (still using computer-use). This prevents test data from polluting the user's real recipe library.

## Credential Safety

**NEVER push captures without sanitization.** The raw mitmdump output contains:

- Bearer JWT tokens in Authorization headers
- Email addresses in JWT payloads
- Full recipe/pantry/grocery data in sync responses

The sanitization step (Phase 5.3) is mandatory. The verification grep (Phase 5.4) is mandatory. If either is skipped, credentials WILL leak into the repository.

**NEVER commit .mitm files.** They contain raw encrypted traffic including auth tokens. Only commit the sanitized `.har.json` files.

## Direct API Verification

When you need to check a field that isn't visible in the capture (e.g., checking if `last_cooked` exists on recipes), use direct API calls. **Credential safety is critical here — never print tokens or credentials to stdout.**

```bash
# Verify creds exist without reading values
grep -c '=' $ENV_FILE

# Load creds into shell environment (values stay in process, not stdout)
set -a && source $ENV_FILE && set +a

# Auth + fetch in one pipeline — token never stored in a variable visible to context
curl -sf -H "Authorization: Bearer $(curl -sf -X POST \
  'https://paprikaapp.com/api/v1/account/login/' \
  --data-urlencode "email=$PAPRIKA_EMAIL" \
  --data-urlencode "password=$PAPRIKA_PASSWORD" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['result']['token'])")" \
  "https://www.paprikaapp.com/api/v2/sync/<endpoint>/" | python3 -m json.tool
```

**Security notes:**

- **Never `cat` or `Read` the `.env` file** — use `source` to load, `grep -c` to verify structure
- **Never store the token in a named variable** and then print it — use command substitution inline
- **Use `--data-urlencode`** for the login POST (email addresses have `+` characters that `-d` mangles)
- Credentials live at `$ENV_FILE` (PAPRIKA_EMAIL, PAPRIKA_PASSWORD)

## Quick Reference

| Phase    | Key Command                                             | Output                                     |
| -------- | ------------------------------------------------------- | ------------------------------------------ |
| Setup    | `networksetup -setautoproxystate "$NETWORK_SERVICE" on` | PAC proxy active                           |
| Capture  | computer-use MCP driving Paprika UI                     | `.mitm` file                               |
| Decode   | `mitmdump -nr <file> -s scripts/decode-capture.py`      | JSON to stdout                             |
| Sanitize | Strip REDACT_PATHS + JWT + email patterns               | Clean JSON                                 |
| HAR      | Convert to HAR 1.2 with `comment` names                 | `docs/wire-captures/<name>.har.json`       |
| Generate | `pnpm generate:fixtures`                                | `src/__fixtures__/wire-captures/<name>.ts` |
| Validate | `pnpm typecheck && pnpm lint && pnpm test`              | All green                                  |

## Common Mistakes

| Mistake                               | Fix                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| Paprika caches proxy at launch        | Restart the app AFTER enabling the proxy                                     |
| Recipe picker clicks are batched      | Click to select, wait, then click Choose separately                          |
| Duplicate HAR comments                | Add context to disambiguate (e.g., "to multi-day menu day 1")                |
| Forgetting to disable proxy           | Always disable in teardown — it affects ALL HTTPS on the machine             |
| Hardcoding "Wi-Fi" as network service | Use `$NETWORK_SERVICE` from prerequisites — could be Ethernet, USB LAN, etc. |
| Pushing .mitm files                   | Only commit sanitized .har.json — add \*.mitm to .gitignore                  |
| Not cleaning up [mcp-cap] data        | Delete all test entities before ending the session                           |
| Using `-d` for login POST             | Use `--data-urlencode` — email addresses have `+` characters                 |
