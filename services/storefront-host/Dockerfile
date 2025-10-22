# ---------- deps (install dev deps for this service)
FROM node:20-alpine AS deps
ENV NODE_ENV=development
WORKDIR /repo/services/storefront-host

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# copy service manifest and a lockfile for deterministic versions
# (we use the root lockfile if you don't keep one inside the service)
COPY pnpm-lock.yaml /repo/pnpm-lock.yaml
COPY services/storefront-host/package.json ./

# install dev+prod deps (types live in devDeps)
RUN pnpm install --frozen-lockfile || pnpm install

# ---------- build (tsc)
FROM node:20-alpine AS build
ENV NODE_ENV=development
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# tsconfig in service extends ../../tsconfig.base.json
COPY tsconfig.base.json ./tsconfig.base.json

# copy sources
COPY services/storefront-host ./services/storefront-host

# bring node_modules from deps stage (contains @types/*)
COPY --from=deps /repo/services/storefront-host/node_modules ./services/storefront-host/node_modules

# compile
WORKDIR /repo/services/storefront-host
# ⛑️ Build + verify dist/server.js exists
RUN pnpm run build \
  && node -e "require('fs').accessSync('dist/server.js')"

# ---------- runtime (slim, prod deps only)
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app

# compiled output
COPY --from=build /repo/services/storefront-host/dist ./dist
# runtime manifest
COPY services/storefront-host/package.json ./

# install only production deps (if any)
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate \
  && pnpm install --prod --frozen-lockfile || pnpm install --prod

EXPOSE 8090
CMD ["node", "/app/dist/server.js"]
