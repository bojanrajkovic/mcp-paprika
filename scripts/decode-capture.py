#!/usr/bin/env python3
# scripts/decode-capture.py
#
# mitmproxy addon script for decoding Paprika API captures.
# Prints a JSON summary of each request/response pair to stdout.
#
# Usage (against an existing capture file):
#   mitmdump -nr /path/to/capture.mitm -s scripts/decode-capture.py
#
# Filter by URL substring (shell-level):
#   mitmdump -nr capture.mitm -s scripts/decode-capture.py 2>/dev/null | \
#     python3 -c "
#   import sys, json
#   for block in sys.stdin.read().split('---'):
#     block = block.strip()
#     if not block: continue
#     try:
#       obj = json.loads(block)
#       if '/sync/recipe' in obj.get('url',''):
#         print(json.dumps(obj, indent=2))
#         print('---')
#     except: pass
#   "

import gzip
import json
from mitmproxy import http

try:
    import brotli as _brotli

    def _brotli_decompress(data: bytes) -> bytes:
        return _brotli.decompress(data)

except ImportError:
    _brotli = None  # type: ignore[assignment]

    def _brotli_decompress(data: bytes) -> bytes:
        raise RuntimeError("brotli not installed")


def _decompress(raw: bytes) -> bytes:
    try:
        return gzip.decompress(raw)
    except Exception:
        pass
    try:
        return _brotli_decompress(raw)
    except Exception:
        pass
    return raw


def _decode_body(raw: bytes, content_type: str) -> object:
    if not raw:
        return None
    raw = _decompress(raw)
    # multipart form-data → decode each part
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
        # Single-field multipart (e.g. one "data" blob): unwrap so the
        # output is the payload itself, not a spurious outer array.
        if len(parts) == 1:
            return parts[0]
        return parts
    # JSON
    try:
        return json.loads(raw)
    except Exception:
        pass
    # Fallback: UTF-8 text
    return raw.decode("utf-8", errors="replace")


def response(flow: http.HTTPFlow) -> None:
    if "paprikaapp.com" not in flow.request.host:
        return

    req = flow.request
    resp = flow.response

    entry = {
        "method": req.method,
        "url": f"{req.scheme}://{req.host}{req.path}",
        "status": resp.status_code if resp else None,
        "request_body": _decode_body(
            req.raw_content or b"",
            req.headers.get("Content-Type", ""),
        ),
        "response_body": _decode_body(
            (resp.raw_content or b"") if resp else b"",
            (resp.headers.get("Content-Type", "") if resp else ""),
        ),
    }

    print(json.dumps(entry, indent=2, default=str))
    print("---")
