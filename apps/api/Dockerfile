FROM node:20-alpine AS deps
WORKDIR /app
COPY apps/api/package*.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY apps/api/ ./
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY apps/api/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY db/migrations ./db/migrations
EXPOSE 3001
CMD ["node", "dist/index.js"]
