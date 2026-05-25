# syntax=docker/dockerfile:1.24

# ─── Stage 1: builder ────────────────────────────────────────────────────────
# Full Debian-based Node image so corepack/pnpm and TypeScript compilation
# have all the tools they need.
FROM node:24-bookworm-slim AS builder

WORKDIR /app

# Enable corepack so the pnpm version pinned in package.json is used.
RUN corepack enable

# Install dependencies first for a clean Docker layer cache. The pnpm store
# cache mount survives across builds and dramatically speeds up `pnpm install`.
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# Now bring in the source and compile.
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

# Pre-create the runtime data directory tree here, in a stage that can chown.
# We copy this tree into the runtime stage with `--chown=nonroot:nonroot` so
# the first writes by `env-paths` (DiskCache, vector index) don't fail when a
# bind-mounted volume is root-owned by default.
RUN mkdir -p /opt/data/config /opt/data/cache


# ─── Stage 2: prod-deps prune ────────────────────────────────────────────────
# A separate install with --prod produces a node_modules tree without dev
# dependencies (TypeScript, vitest, oxlint, etc.) — keeps the runtime image
# small.
FROM node:24-bookworm-slim AS prod-deps

WORKDIR /app
RUN corepack enable

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=pnpm-lock.yaml,target=pnpm-lock.yaml \
    pnpm install --frozen-lockfile --prod --ignore-scripts


# ─── Stage 3: runtime ────────────────────────────────────────────────────────
# Distroless `nodejs24-debian13:nonroot` ships a built-in `ENTRYPOINT
# ["/nodejs/bin/node"]` and runs as user 65532 (nonroot). We only need to
# supply CMD args.
FROM gcr.io/distroless/nodejs24-debian13:nonroot

WORKDIR /app

COPY --link --from=prod-deps /app/node_modules ./node_modules
COPY --link --from=builder /app/dist ./dist
COPY --link --from=builder /app/package.json ./package.json
COPY --link scripts/healthcheck.mjs ./scripts/healthcheck.mjs

# `/data` is the documented mount point. Pre-create the XDG sub-dirs with
# nonroot ownership so the disk cache and vector index can write on the
# first run even when `/data` is bind-mounted from a fresh host directory.
# Without this, Docker volumes are root-owned and `:nonroot` cannot write.
COPY --from=builder --chown=nonroot:nonroot /opt/data /data

# env-paths uses XDG_*_HOME when set; distroless has no $HOME so the env
# vars are the only thing keeping cache/config writes inside /data.
ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    MCP_HTTP_PORT=3000 \
    MCP_HTTP_HOST=0.0.0.0 \
    XDG_CONFIG_HOME=/data/config \
    XDG_CACHE_HOME=/data/cache

VOLUME ["/data"]
EXPOSE 3000

USER nonroot

# HEALTHCHECK exec form does NOT inherit the container ENTRYPOINT (only the
# top-level CMD does), and distroless has no shell — so spell out the node
# binary explicitly. The script file is also not chmod +x, but that doesn't
# matter when we invoke it via the interpreter.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["/nodejs/bin/node", "/app/scripts/healthcheck.mjs"]

CMD ["/app/dist/index.js"]
