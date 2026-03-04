# Bun-based multi-stage Dockerfile for production deployment

# ---- Base stage with Bun ----
FROM oven/bun:1.3.5-slim AS base
WORKDIR /usr/src/app

# ---- Dependencies install (caching) ----
FROM base AS deps
COPY app/package.json app/bun.lock ./
RUN bun install --frozen-lockfile

# ---- Build stage ----
FROM deps AS builder
ARG GIT_REF
ENV GIT_REF=$GIT_REF
COPY app ./
RUN bun run build

# ---- Final production stage ----
FROM oven/bun:1.3.5-slim AS production
WORKDIR /usr/src/app

# Install Chromium for Puppeteer (SEO link checking / Cloudflare bypass)
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
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_PATH=/usr/bin/chromium

# Copy production dependencies and build output
COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/build ./build
COPY --from=builder /usr/src/app/package.json ./
COPY --from=builder /usr/src/app/drizzle ./build/drizzle
COPY --from=builder /usr/src/app/src/lib/server/assets ./build/server/chunks/assets

USER bun

CMD [ "bun", "build/index.js" ]