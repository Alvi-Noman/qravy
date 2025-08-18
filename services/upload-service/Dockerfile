FROM node:20-alpine

WORKDIR /app
RUN apk add --no-cache libc6-compat && corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages ./packages
COPY services/upload-service/package.json ./services/upload-service/package.json

RUN pnpm install --frozen-lockfile

COPY services/upload-service ./services/upload-service

WORKDIR /app/services/upload-service
EXPOSE 4010
CMD ["node", "dist/server.js"]