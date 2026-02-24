FROM node:20-alpine AS deps
WORKDIR /app
COPY apps/game-server/package*.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY apps/game-server/ ./
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY apps/game-server/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3003
CMD ["node", "dist/index.js"]
