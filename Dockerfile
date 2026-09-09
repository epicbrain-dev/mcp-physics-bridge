# ==============================================================================
# Stage 1: Build & Compilation Stage
# ==============================================================================
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install build essentials for native better-sqlite3 compilation if needed
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json tsconfig.json asconfig.json ./
RUN npm ci

COPY proto ./proto
COPY src ./src

# Compile in-memory AssemblyScript Wasm math binaries and TypeScript
RUN npm run build:as
RUN npm run build

# ==============================================================================
# Stage 2: Minimal Production Runtime Stage
# ==============================================================================
FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production

WORKDIR /app

# Install runtime dependencies for SQLite
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled artifacts from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/build ./build
COPY --from=builder /app/proto ./proto

# Ensure persistent data directory with proper ownership for non-root user
RUN mkdir -p /app/data && chown -R node:node /app

USER node

# Default ports:
# 50051: Native engine HTTP/2 gRPC bi-directional stream
# 50052: Web engine gRPC-Web / JSON gateway proxy
# 8080:  Web engine 60 FPS continuous physics WebSocket
EXPOSE 50051 50052 8080

HEALTHCHECK --interval=20s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:50052/').then(r => process.exit(r.status ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
