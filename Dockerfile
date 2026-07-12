FROM node:22-slim

WORKDIR /app

# Install dependencies first for layer caching. We keep dev deps in the image
# because the server runs via `tsx` (no separate compile step) and migrations
# run via drizzle-kit-generated SQL. This is the boring, reliable path.
COPY package.json package-lock.json ./
RUN npm ci

# App source, built frontend, migrations.
COPY . .
RUN npm run build:web

ENV NODE_ENV=production
EXPOSE 3000

RUN chmod +x docker-entrypoint.sh
CMD ["./docker-entrypoint.sh"]
