# ---------- deps (install only what's needed from the workspace)
FROM node:20-alpine AS deps
ENV NODE_ENV=development
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# Workspace manifests
COPY package.json ./package.json
COPY pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY pnpm-lock.yaml ./pnpm-lock.yaml

# Minimal manifests for local packages used by api-gateway
COPY packages/config/package.json        ./packages/config/package.json
COPY packages/shared/package.json        ./packages/shared/package.json
COPY services/api-gateway/package.json   ./services/api-gateway/package.json

# Install deps for the service + its local workspace deps (dev deps included)
RUN pnpm install --no-frozen-lockfile --filter ./services/api-gateway...

# Make sure build-time tools/types exist in the service workspace
RUN pnpm add -D typescript @types/node --filter ./services/api-gateway \
 && pnpm --filter ./services/api-gateway ls -P typescript @types/node

# ---------- build (compile TypeScript & prepare deployable bundle)
FROM node:20-alpine AS build
ENV NODE_ENV=development
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# Base tsconfig if extended
COPY tsconfig.base.json ./tsconfig.base.json

# Full sources
COPY packages/config            ./packages/config
COPY packages/shared            ./packages/shared
COPY services/api-gateway       ./services/api-gateway

# Reuse workspace installs
COPY --from=deps /repo/node_modules                        ./node_modules
COPY --from=deps /repo/pnpm-lock.yaml                      ./pnpm-lock.yaml
COPY --from=deps /repo/pnpm-workspace.yaml                 ./pnpm-workspace.yaml
COPY --from=deps /repo/package.json                        ./package.json
# IMPORTANT: copy the package-level node_modules (pnpm symlink folder)
COPY --from=deps /repo/services/api-gateway/node_modules   ./services/api-gateway/node_modules

# Build (prints full diagnostics if it fails)
WORKDIR /repo/services/api-gateway
# try the normal build; on failure, run a plain tsc with useful flags to show everything
RUN pnpm run build \
 || (echo "---- tsc diagnostic fallback ----" \
  && npx tsc -p tsconfig.build.json --pretty false --listFiles --traceResolution \
  && exit 1)

# Create a self-contained production-only bundle (no workspace links)
WORKDIR /repo
RUN pnpm deploy --filter ./services/api-gateway --prod /out \
 && mkdir -p /out/dist \
 && cp -r /repo/services/api-gateway/dist/* /out/dist/

# ---------- runtime (slim, no install needed)
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app

# Drop in the deploy bundle
COPY --from=build /out/ ./

EXPOSE 8080
CMD ["node", "dist/server.js"]
