# Multi-stage build:
#  1) builder    — install everything (incl. devDeps), compile TS to dist/
#  2) runtime    — slim runtime with Chromium, only prod deps + dist/ + public/
#
# Why multi-stage: the final image stays under ~600 MB even with Chromium,
# vs ~1.4 GB if we keep the full build environment. Also keeps source
# code OUT of production images.

# ───────────────────────── builder ─────────────────────────
FROM node:20-bookworm AS builder

WORKDIR /app

# Install ALL deps (incl. devDeps) for `tsc` + types.
COPY package*.json ./
RUN npm ci --no-audit --no-fund

# Copy sources and compile.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop devDeps so we can copy node_modules straight to runtime later.
RUN npm prune --omit=dev

# ───────────────────────── runtime ─────────────────────────
FROM node:20-bookworm-slim AS runtime

# System Chromium + the few shared libs Playwright needs at runtime.
# We use system Chromium instead of Playwright's bundled browser so the
# image is smaller and reproducible across architectures.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      fonts-liberation \
      fonts-noto-color-emoji \
      libnss3 \
      libxss1 \
      libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Tell Playwright to use the system Chromium and skip its own browser
# download (we set this both at install time and runtime).
ENV CHROME_BIN=/usr/bin/chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV NODE_ENV=production

WORKDIR /app

# Copy the build output and pruned production deps from the builder.
# package.json is needed at runtime so `node` resolves "type": "module".
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
# Maker fonts read from disk at runtime (readFileSync, not bundled by tsc) —
# without these, POST /api/maker/brat and /api/maker/smeme throw ENOENT.
COPY src/modules/makers/brat/assets ./dist/modules/makers/brat/assets
COPY src/modules/makers/smeme/assets ./dist/modules/makers/smeme/assets
# Static landing page is served by Fastify at runtime.
COPY public ./public
# Schema kept for ops (run once via Supabase SQL editor on first deploy).
COPY supabase ./supabase

# Run as the unprivileged `node` user that ships with the official image.
# Chromium especially appreciates not running as root.
USER node

EXPOSE 3000

# `npm start` runs `node dist/server.js` per package.json. We bypass npm
# in CMD to avoid an unnecessary parent process and forward signals
# (SIGTERM) directly to Node — important for graceful shutdown.
CMD ["node", "dist/server.js"]
