# syntax=docker/dockerfile:1
FROM node:24-slim AS build
WORKDIR /repo
RUN npm install -g pnpm@11.10.0
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build \
  && pnpm --filter @novarium/server deploy --prod --legacy /out

FROM node:24-slim
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    WEB_DIR=/app/web \
    MIGRATIONS_DIR=/app/migrations
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/server/dist ./dist
COPY --from=build /repo/apps/server/migrations ./migrations
COPY --from=build /repo/apps/web/dist ./web
VOLUME /data
EXPOSE 8080
CMD ["node", "dist/node.js"]
