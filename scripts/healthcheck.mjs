#!/usr/bin/env node
// Container HEALTHCHECK probe. Issues GET /healthz against the local HTTP
// transport; exits 0 on a 2xx response, 1 otherwise. Zero-dep: uses only
// node:http so it works inside the distroless runtime image.

import { request } from "node:http";

const port = process.env.MCP_HTTP_PORT ?? "3000";
const host = "127.0.0.1";
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
