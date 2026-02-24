FROM node:20-alpine AS deps
WORKDIR /app
COPY apps/web/package*.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY apps/web/ ./
ARG VITE_GAME_WS_URL=
ENV VITE_GAME_WS_URL=$VITE_GAME_WS_URL
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/nginx/web.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
