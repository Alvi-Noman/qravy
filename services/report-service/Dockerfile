FROM node:18-alpine

WORKDIR /app

# Copy the entire monorepo into the container
COPY . .

# Install pnpm globally
RUN npm install -g pnpm

# Install all dependencies for the monorepo
RUN pnpm install --frozen-lockfile

# Only build the target service and its dependencies using Turbo and pnpm
RUN pnpm turbo run build --filter=@muvance/report-service...

WORKDIR /app/services/report-service

EXPOSE 3003
CMD ["pnpm", "start"]