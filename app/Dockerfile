# Bun-based multi-stage Dockerfile for production deployment

# ---- Base stage with Bun ----
FROM oven/bun:1.3.5-slim AS base
WORKDIR /usr/src/app

# ---- Dependencies install (caching) ----
FROM base AS deps
# Skip Puppeteer's bundled Chromium download — we use system Chromium in production
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY app/package.json app/bun.lock ./
RUN bun install --frozen-lockfile

# ---- Build stage ----
FROM deps AS builder
ARG GIT_REF
ENV GIT_REF=$GIT_REF
# Cache invalidation strategy:
#   - GIT_REF: set by CI per commit → each commit forces fresh bun run build
#   - BUILD_MARKER: manual bump for one-off force-rebuilds (when CI didn't
#     pass GIT_REF correctly, or when base images changed in a non-content
#     way). Bump the value inline below when you need to force a full rebuild.
ARG CACHE_BUST=1
ARG BUILD_MARKER=whmcs-keez-autopush-2026-04-25-05
RUN echo "cache-bust: ${GIT_REF:-$CACHE_BUST}-${BUILD_MARKER}"
COPY app ./
RUN bun run build

# ---- Final production stage ----
FROM oven/bun:1.3.5-slim AS production
WORKDIR /usr/src/app

# Install Chromium + all required libs for Puppeteer headless
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxext6 \
    libxfixes3 \
    libxshmfence1 \
    libglib2.0-0 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libdbus-1-3 \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Copy production dependencies and build output
COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/build ./build
COPY --from=builder /usr/src/app/package.json ./
COPY --from=builder /usr/src/app/drizzle ./build/drizzle
COPY --from=builder /usr/src/app/src/lib/server/assets ./build/server/chunks/assets

# Ensure writable dirs for Puppeteer user data
RUN mkdir -p /tmp/.chromium-data && chown bun:bun /tmp/.chromium-data

USER bun

CMD [ "bun", "build/index.js" ]