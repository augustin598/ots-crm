# Bun-based multi-stage Dockerfile for production deployment

# ---- Base stage with Bun ----
FROM oven/bun:slim AS base
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
FROM oven/bun:slim AS production
WORKDIR /usr/src/app

# Copy production dependencies and build output
COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/build ./build
COPY --from=builder /usr/src/app/package.json ./
COPY --from=builder /usr/src/app/drizzle ./drizzle

USER bun

CMD [ "bun", "build/index.js" ]