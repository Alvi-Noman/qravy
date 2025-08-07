FROM node:18-alpine

WORKDIR /app

# Copy the entire monorepo into the container
COPY . .

# Install pnpm globally
RUN npm install -g pnpm

# Install all dependencies for the monorepo
RUN pnpm install --frozen-lockfile

# Only build the target service and its dependencies using Turbo and pnpm
RUN pnpm turbo run build --filter=@muvance/activity-feed-service...

WORKDIR /app/services/activity-feed-service

EXPOSE 3002
CMD ["pnpm", "start"]