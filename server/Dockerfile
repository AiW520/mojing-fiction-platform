FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY scripts ./scripts
COPY content ./content
RUN mkdir -p data backups && chown -R node:node data backups
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 ALLOW_DEV_AUTH=0
EXPOSE 3000
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--experimental-sqlite", "src/server.mjs"]
