FROM node:22-bookworm-slim AS build
WORKDIR /build
COPY admin-web/package*.json ./
RUN npm ci
COPY admin-web/ ./
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /build/dist /srv/admin
COPY server/deploy/Caddyfile /etc/caddy/Caddyfile
