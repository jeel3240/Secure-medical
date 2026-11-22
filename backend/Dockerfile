# Two stages from one file (review H13, 2026-11-22). docs/WORKFLOW.md, "The images".
#
# `dev` - every dependency, the source and the scripts: what local compose runs
# (`target: dev`, ts-node with src/ mounted) and what `npm run build` compiles in.
FROM node:20-alpine AS dev
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
CMD ["npm", "run", "dev:api"]

# `production` - what the server runs (docker-compose.prod.yml, `target: production`):
# the compiled dist/, production dependencies only, and what `npm run migrate`
# reads. No ts-node, no tests, no dev scripts - those cannot run here at all -
# and the unprivileged `node` user, not root.
FROM node:20-alpine AS production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=dev /app/dist ./dist
COPY scripts/migrate.js ./scripts/migrate.js
COPY src/db/migrations ./src/db/migrations
USER node
CMD ["npm", "run", "api"]
