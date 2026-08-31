FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:774b7d020b24214835769e24c3544835526cd0288f0b094eae48e8b2c2429a79 AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=65532:65532 --from=build /app/package.json ./package.json
COPY --chown=65532:65532 --from=build /app/node_modules ./node_modules
COPY --chown=65532:65532 --from=build /app/dist ./dist
USER 65532:65532
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["dist/server.js"]
