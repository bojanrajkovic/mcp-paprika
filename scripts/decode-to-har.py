#!/usr/bin/env python3
# scripts/decode-to-har.py
#
# mitmproxy addon that converts a .mitm capture into a sanitized HAR 1.2 file
# in one shot — no LLM hand-construction step. Bodies are decompressed and
# JSON-parsed in Python, then re-serialized via json.dumps, which preserves
# native types byte-equivalently (int stays int, null stays null, bool stays
# bool). This eliminates the class of bugs introduced by an LLM "helpfully"
# reformatting values (e.g. seconds-since-midnight integers quoted as time
# strings — see commit a32e660).
#
# Usage:
#   mitmdump -nr <capture.mitm> -s scripts/decode-to-har.py \
#     --set comments=<capture>.comments.json \
#     --set out=docs/wire-captures/<name>.har.json
#
# Comments file format (JSON, indexed by string flow indices — JSON object
# keys are always strings, but the script also accepts integer keys for
# convenience. Indices are 0-based and count only paprikaapp.com requests;
# non-paprika flows are ignored entirely):
#
#   {
#     "0": "skip",
#     "1": "skip",
#     "2": "create mealtype ([mcp-cap] Brunch)",
#     "3": "skip",
#     "4": "delete mealtype ([mcp-cap] Brunch soft-delete)"
#   }
#
# Run the script once without --set out=... to see the flow index → URL
# mapping printed to stderr; use that to write the JSON file, then run
# again with --set out to emit the HAR.

import gzip
import json
import sys
from mitmproxy import http, ctx

try:
    import brotli as _brotli

    def _brotli_decompress(data: bytes) -> bytes:
        return _brotli.decompress(data)

except ImportError:
    _brotli = None

    def _brotli_decompress(data: bytes) -> bytes:
        raise RuntimeError("brotli not installed")




def _decompress(raw: bytes) -> bytes:
    """Try gzip, then brotli, then return raw."""
    try:
        return gzip.decompress(raw)
    except Exception:
        pass
    try:
        return _brotli_decompress(raw)
    except Exception:
        pass
    return raw


def _decode_body(raw: bytes, content_type: str):
    """Decode a request/response body into a native Python value.

    Returns the parsed JSON (dict/list/scalar) when possible, the raw UTF-8
    string when not, or None when the body is empty. Multipart bodies with a
    single 'data' field are unwrapped to just the inner payload — this matches
    decode-capture.py's behaviour (see commit a825af7 for the "spurious double-
    nesting" history).
    """
    if not raw:
        return None
    raw = _decompress(raw)
    if "boundary=" in content_type:
        boundary = ("--" + content_type.split("boundary=", 1)[1].strip()).encode()
        parts = []
        for part in raw.split(boundary):
            if b"\r\n\r\n" not in part:
                continue
            _, content = part.split(b"\r\n\r\n", 1)
            content = content.rstrip(b"\r\n--")
            content = _decompress(content)
            try:
                parts.append(json.loads(content))
            except Exception:
                parts.append(content.decode("utf-8", errors="replace"))
        if len(parts) == 1:
            return parts[0]
        return parts
    try:
        return json.loads(raw)
    except Exception:
        pass
    return raw.decode("utf-8", errors="replace")


def _sanitize_headers(headers) -> list:
    """Convert mitmproxy headers to HAR format, redacting credentials."""
    REDACT_HEADER_NAMES = {"authorization", "cookie", "set-cookie", "x-api-key"}
    out = []
    for name, value in headers.items():
        if name.lower() in REDACT_HEADER_NAMES:
            value = "[REDACTED]"
        out.append({"name": name, "value": value})
    return out


def _body_to_har_text(body):
    """Serialise a decoded body back to a JSON string for the HAR.

    Uses json.dumps with default indent — preserves native types byte-
    equivalently. Strings (non-JSON bodies) pass through verbatim.
    """
    if body is None:
        return ""
    if isinstance(body, str):
        return body
    return json.dumps(body)


class HarEmitter:
    def __init__(self):
        self.entries = []
        self.flow_index = 0
        self.comments = {}
        self.url_log = []  # for --set out unset: print flow→url mapping
        self.has_out = False

    def load(self, loader):
        loader.add_option("comments", str, "", "JSON file mapping flow index (as string key) → HAR comment")
        loader.add_option("out", str, "", "Output HAR path. If unset, prints flow→url table to stderr.")

    def running(self):
        self.has_out = bool(ctx.options.out)
        if ctx.options.comments:
            with open(ctx.options.comments) as f:
                raw = json.load(f)
            # Normalise keys: accept both "2" and 2.
            self.comments = {int(k): v for k, v in raw.items()}

    def response(self, flow: http.HTTPFlow) -> None:
        if "paprikaapp.com" not in flow.request.host:
            return

        idx = self.flow_index
        self.flow_index += 1
        # Normalize host: Paprika.app sends to www.paprikaapp.com but our
        # PaprikaClient uses the bare paprikaapp.com. Both resolve to the same
        # backend; we strip the www so HAR-derived MSW handlers match what the
        # client actually requests. This is a transport-layer fact, NOT body
        # reformatting — value types inside the body are still preserved verbatim.
        host = flow.request.host
        if host == "www.paprikaapp.com":
            host = "paprikaapp.com"
        url = f"{flow.request.scheme}://{host}{flow.request.path}"
        self.url_log.append((idx, flow.request.method, url))

        comment = self.comments.get(idx) if self.comments else None
        # If no comments file was provided, we're in survey mode — record nothing.
        if not comment or comment == "skip":
            return

        req_body = _decode_body(
            flow.request.raw_content or b"",
            flow.request.headers.get("Content-Type", ""),
        )
        resp_body = _decode_body(
            flow.response.raw_content or b"" if flow.response else b"",
            flow.response.headers.get("Content-Type", "") if flow.response else "",
        )

        request = {
            "method": flow.request.method,
            "url": url,
            "httpVersion": flow.request.http_version,
            "cookies": [],
            "headers": _sanitize_headers(flow.request.headers),
            "queryString": [],
            "headersSize": -1,
            "bodySize": len(flow.request.raw_content or b""),
        }
        if req_body is not None:
            request["postData"] = {
                "mimeType": flow.request.headers.get("Content-Type", "application/octet-stream"),
                "text": _body_to_har_text(req_body),
            }

        response = {
            "status": flow.response.status_code if flow.response else 0,
            "statusText": flow.response.reason if flow.response else "",
            "httpVersion": flow.response.http_version if flow.response else "HTTP/1.1",
            "cookies": [],
            "headers": _sanitize_headers(flow.response.headers) if flow.response else [],
            "content": {
                "size": len(flow.response.raw_content or b"") if flow.response else 0,
                "mimeType": flow.response.headers.get("Content-Type", "") if flow.response else "",
                "text": _body_to_har_text(resp_body),
            },
            "redirectURL": "",
            "headersSize": -1,
            "bodySize": len(flow.response.raw_content or b"") if flow.response else 0,
        }

        self.entries.append({
            "comment": comment,
            "startedDateTime": flow.request.timestamp_start_iso if hasattr(flow.request, "timestamp_start_iso") else "",
            "time": 0,
            "request": request,
            "response": response,
            "cache": {},
            "timings": {"send": 0, "wait": 0, "receive": 0},
        })

    def done(self):
        if not self.has_out:
            sys.stderr.write("\n=== Flow → URL mapping (use this to write the .comments.yaml) ===\n")
            for idx, method, url in self.url_log:
                sys.stderr.write(f"  {idx}: # {method} {url}\n")
            sys.stderr.write(
                f"\n{len(self.url_log)} paprikaapp.com flow(s). Map each to a HAR comment string "
                "(or 'skip'), then re-run with --set out=<path>.\n"
            )
            return

        har = {
            "log": {
                "version": "1.2",
                "creator": {"name": "mitmproxy + decode-to-har.py", "version": "1.0"},
                "entries": self.entries,
            }
        }
        with open(ctx.options.out, "w") as f:
            json.dump(har, f, indent=2)
            f.write("\n")
        ctx.log.info(f"Wrote {len(self.entries)} entries to {ctx.options.out}")


# Workaround: mitmproxy's hasattr check on timestamp_start_iso may not exist
# in older versions; use a portable conversion if not.
def _patch_timestamp():
    from datetime import datetime, timezone

    def iso_ts(self):
        return datetime.fromtimestamp(self.timestamp_start, tz=timezone.utc).isoformat()

    if not hasattr(http.Request, "timestamp_start_iso"):
        http.Request.timestamp_start_iso = property(iso_ts)


_patch_timestamp()

addons = [HarEmitter()]
