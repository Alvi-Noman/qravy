FROM node:20-alpine

WORKDIR /app

COPY . .

RUN npm uninstall -g ts-node || true
RUN npm install -g pnpm nodemon typescript ts-node@latest tsx

RUN pnpm install --frozen-lockfile

RUN pnpm turbo run build --filter=@muvance/auth-service...

WORKDIR /app/services/auth-service

EXPOSE 3001
CMD ["pnpm", "start"]