# --- Frontend build stage ---
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY ../study-room-frontend/package.json ./
RUN npm install
COPY ../study-room-frontend/ .
RUN npm run build

# --- Nginx gateway ---
FROM nginx:1.25-alpine
RUN rm /etc/nginx/conf.d/default.conf
COPY study-room-backend/nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
