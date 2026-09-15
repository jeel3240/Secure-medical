# Production web server image, not a frontend dev container.
# Builds the React app, then serves it from Caddy, which also terminates HTTPS
# and forwards /api to the API. Used by the caddy service in
# docker-compose.prod.yml; local development uses `npm run dev` instead.
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2
COPY --from=build /app/dist /srv
