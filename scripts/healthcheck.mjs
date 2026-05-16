#!/usr/bin/env node
// Container HEALTHCHECK probe. Issues GET /healthz against the local HTTP
// transport; exits 0 on a 2xx response, 1 otherwise. Zero-dep: uses only
// node:http so it works inside the distroless runtime image.

import { request } from "node:http";

const port = process.env.MCP_HTTP_PORT ?? "3000";
// Probe the actual bind address, falling back to loopback for the
// listen-everywhere defaults. Without this, setting MCP_HTTP_HOST to a
// specific non-loopback interface would mark the container unhealthy even
// while the server happily serves traffic.
//
//   "0.0.0.0" / ""  → listens on all IPv4 interfaces → probe via 127.0.0.1
//   "::"            → listens on all IPv6 interfaces → probe via ::1
//   anything else   → probe the exact host the server binds to
const configured = process.env.MCP_HTTP_HOST ?? "";
let host;
if (configured === "" || configured === "0.0.0.0") {
  host = "127.0.0.1";
} else if (configured === "::") {
  host = "::1";
} else {
  host = configured;
}
const timeoutMs = 4000;

const req = request(
  {
    method: "GET",
    host,
    port: Number(port),
    path: "/healthz",
    timeout: timeoutMs,
  },
  (res) => {
    if (res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300) {
      // Drain body so the socket can close cleanly.
      res.resume();
      res.on("end", () => process.exit(0));
    } else {
      process.exit(1);
    }
  },
);

req.on("error", () => process.exit(1));
req.on("timeout", () => {
  req.destroy();
  process.exit(1);
});
req.end();
