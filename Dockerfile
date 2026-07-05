# syntax=docker/dockerfile:1
# Static-site image: Node builds dist/, nginx serves it. Mirrors the blog's
# multi-stage shape; serves on :3002 behind Nginx Proxy Manager.

FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runner
# Pretty URLs: /blog resolves to /blog/index.html, /blog/posts/<slug> to
# <slug>.html — same behavior Cloudflare Pages gives the upstream site.
RUN printf 'server {\n\
  listen 3002;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
  location / {\n\
    try_files $uri $uri.html $uri/ =404;\n\
  }\n\
}\n' > /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3002/ >/dev/null 2>&1 || exit 1
