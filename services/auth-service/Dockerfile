FROM node:20-alpine

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages ./packages
COPY services/auth-service/package.json ./services/auth-service/package.json

RUN pnpm install --frozen-lockfile

COPY services/auth-service ./services/auth-service

WORKDIR /app/services/auth-service
EXPOSE 3001
CMD ["node", "dist/server.js"]