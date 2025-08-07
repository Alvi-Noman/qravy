FROM node:18-alpine

WORKDIR /app

# Copy the entire monorepo into the container
COPY . .

# Install pnpm globally
RUN npm install -g pnpm

# Install all dependencies for the monorepo
RUN pnpm install --frozen-lockfile

# Only build the target service and its dependencies using Turbo and pnpm
RUN pnpm turbo run build --filter=@muvance/integration-service...

WORKDIR /app/services/integration-service

EXPOSE 3004
CMD ["pnpm", "start"]