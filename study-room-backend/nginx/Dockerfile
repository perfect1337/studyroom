# syntax=docker/dockerfile:1
# --- Frontend build stage ---
FROM node:20-alpine AS frontend-builder
WORKDIR /app
ENV NODE_OPTIONS=--dns-result-order=ipv4first

COPY study-room-frontend/package.json study-room-frontend/package-lock.json ./
RUN npm config set fetch-retries 5 fetch-retry-mintimeout 20000 fetch-timeout 120000 \
 && npm ci --no-audit --no-fund

COPY study-room-frontend/ .
RUN npm run build

# --- Nginx gateway ---
FROM nginx:1.25-alpine
RUN rm /etc/nginx/conf.d/default.conf
COPY study-room-backend/nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
