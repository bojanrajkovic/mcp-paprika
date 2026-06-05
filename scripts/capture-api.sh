#!/usr/bin/env bash
# scripts/capture-api.sh
#
# Capture Paprika API traffic via mitmproxy using a PAC file so only
# paprikaapp.com traffic is proxied (not the whole system).
#
# Prerequisites:
#   brew install mitmproxy
#   Trust the mitmproxy CA cert once (the script prompts on first run):
#     sudo security add-trusted-cert -d -r trustRoot \
#       -k /Library/Keychains/System.keychain \
#       ~/.mitmproxy/mitmproxy-ca-cert.pem
#
# Usage:
#   ./scripts/capture-api.sh [options]
#
# Options:
#   --out FILE          Output .mitm capture file (default: /tmp/paprika-capture-<timestamp>.mitm)
#   --host GLOB         Host glob to proxy (default: paprikaapp.com)
#   --port PORT         mitmproxy listen port (default: 8888)
#   --pac-port PORT     PAC file server port (default: 8889)
#   --service NAME      macOS network service name (default: Wi-Fi)
#
# After capturing, survey the flows with:
#   mitmdump -nr <capture.mitm> -s scripts/decode-to-har.py
# then follow docs/wire-captures/README.md to emit a sanitized HAR.
# (scripts/decode-capture.py dumps decoded JSON to stdout for ad-hoc inspection.)

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
PROXY_HOST="paprikaapp.com"
PROXY_PORT=8888
PAC_PORT=8889
NETWORK_SERVICE="Wi-Fi"
OUT_FILE="/tmp/paprika-capture-$(date +%Y%m%d-%H%M%S).mitm"

# ── Arg parsing ───────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out)       OUT_FILE="$2";         shift 2 ;;
    --host)      PROXY_HOST="$2";       shift 2 ;;
    --port)      PROXY_PORT="$2";       shift 2 ;;
    --pac-port)  PAC_PORT="$2";         shift 2 ;;
    --service)   NETWORK_SERVICE="$2";  shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# ── Prereq checks ─────────────────────────────────────────────────────────────
if ! command -v mitmdump &>/dev/null; then
  echo "Error: mitmdump not found. Install with: brew install mitmproxy" >&2
  exit 1
fi
if ! command -v python3 &>/dev/null; then
  echo "Error: python3 not found." >&2
  exit 1
fi
if [[ "$(uname)" != "Darwin" ]]; then
  echo "Error: this script uses networksetup, which is macOS-only." >&2
  exit 1
fi

CA_CERT="$HOME/.mitmproxy/mitmproxy-ca-cert.pem"
if [[ ! -f "$CA_CERT" ]]; then
  echo "mitmproxy CA cert not found at $CA_CERT."
  echo "Run mitmproxy once to generate it, then trust it:"
  echo "  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain $CA_CERT"
  exit 1
fi

# ── Temp dir for PAC file ─────────────────────────────────────────────────────
TMPDIR_PAC="$(mktemp -d)"
PAC_FILE="$TMPDIR_PAC/proxy.pac"

cat > "$PAC_FILE" <<EOF
function FindProxyForURL(url, host) {
    if (shExpMatch(host, "*.$PROXY_HOST") || host === "$PROXY_HOST") {
        return "PROXY 127.0.0.1:$PROXY_PORT";
    }
    return "DIRECT";
}
EOF

# ── Cleanup (runs on exit and Ctrl+C) ─────────────────────────────────────────
PAC_SERVER_PID=""
MITMDUMP_PID=""
cleanup() {
  echo ""
  echo "→ Tearing down..."
  networksetup -setautoproxystate "$NETWORK_SERVICE" off 2>/dev/null || true
  [[ -n "$MITMDUMP_PID" ]] && kill "$MITMDUMP_PID" 2>/dev/null || true
  [[ -n "$PAC_SERVER_PID" ]] && kill "$PAC_SERVER_PID" 2>/dev/null || true
  rm -rf "$TMPDIR_PAC"
  echo "→ Proxy disabled. Capture saved to: $OUT_FILE"
  echo ""
  echo "Survey flows with:"
  echo "  mitmdump -nr $OUT_FILE -s scripts/decode-to-har.py"
  echo "then follow docs/wire-captures/README.md to emit a sanitized HAR."
}
trap cleanup EXIT

# ── Start PAC server ──────────────────────────────────────────────────────────
python3 -m http.server "$PAC_PORT" --directory "$TMPDIR_PAC" &>/dev/null &
PAC_SERVER_PID=$!
sleep 0.5

# Verify PAC server is up
if ! curl -sf "http://127.0.0.1:$PAC_PORT/proxy.pac" &>/dev/null; then
  echo "Error: PAC server failed to start on port $PAC_PORT" >&2
  exit 1
fi

# ── Start mitmdump ────────────────────────────────────────────────────────────
mitmdump \
  --listen-port "$PROXY_PORT" \
  --save-stream-file "$OUT_FILE" \
  --set "flow_detail=2" \
  --allow-hosts "${PROXY_HOST//./\\.}" \
  &>/dev/null &
MITMDUMP_PID=$!
sleep 0.5

if ! kill -0 "$MITMDUMP_PID" 2>/dev/null; then
  echo "Error: mitmdump failed to start." >&2
  exit 1
fi

# ── Enable PAC proxy ──────────────────────────────────────────────────────────
networksetup -setautoproxyurl "$NETWORK_SERVICE" "http://127.0.0.1:$PAC_PORT/proxy.pac"
networksetup -setautoproxystate "$NETWORK_SERVICE" on

# ── Instructions ─────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║         Paprika API capture running                      ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Proxying:  $PROXY_HOST"
echo "║  Saving to: $OUT_FILE"
echo "║                                                          ║"
echo "║  Perform the operations you want to capture in           ║"
echo "║  Paprika.app, then press Enter or Ctrl+C to stop.        ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

read -r -p "Press Enter to stop capturing..."
