FROM node:20-alpine

WORKDIR /app
RUN corepack enable

# Monorepo roots
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages ./packages
COPY services/auth-service/package.json ./services/auth-service/package.json

# Install deps for the workspace (prod only to shrink image)
RUN pnpm install --frozen-lockfile

# Copy service source
COPY services/auth-service ./services/auth-service

# Build the service
WORKDIR /app/services/auth-service
RUN pnpm build

ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "dist/server.js"]
FROM node:20-alpine

WORKDIR /app
RUN corepack enable

# Monorepo roots
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages ./packages
COPY services/auth-service/package.json ./services/auth-service/package.json

# Install deps for the workspace (prod only to shrink image)
RUN pnpm install --frozen-lockfile

# Copy service source
COPY services/auth-service ./services/auth-service

# Build the service
WORKDIR /app/services/auth-service
RUN pnpm build

ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "dist/server.js"]
