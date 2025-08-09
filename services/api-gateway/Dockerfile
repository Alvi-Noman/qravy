FROM node:20-alpine

WORKDIR /app

COPY . .

RUN npm uninstall -g ts-node || true
RUN npm install -g pnpm nodemon typescript ts-node@latest tsx

RUN pnpm install --frozen-lockfile

# Only build the target service and its dependencies using Turbo and pnpm
RUN pnpm turbo run build --filter=@muvance/api-gateway...

WORKDIR /app/services/api-gateway

EXPOSE 8080
CMD ["pnpm", "start"]