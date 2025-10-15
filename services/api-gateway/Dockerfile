FROM node:20-alpine

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages ./packages
COPY services/api-gateway/package.json ./services/api-gateway/package.json

RUN pnpm install --frozen-lockfile
COPY services/api-gateway ./services/api-gateway

WORKDIR /app/services/api-gateway
RUN pnpm build

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "dist/server.js"]
