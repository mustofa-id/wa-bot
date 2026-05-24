# syntax = docker/dockerfile:1

FROM node:24.16-slim AS base

# ------- System Dependencies -------

# Layer 1 — stable system deps (rarely invalidated)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ghostscript \
    libreoffice-core \
    libreoffice-writer \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Layer 2 — yt-dlp (only invalidated on yt-dlp releases)
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && arch=$(uname -m) \
    && case "$arch" in \
        x86_64) yt_arch="linux" ;; \
        aarch64|arm64) yt_arch="linux_aarch64" ;; \
        *) echo "Unsupported arch: $arch"; exit 1 ;; \
    esac \
    && curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_${yt_arch}" -o /usr/local/bin/yt-dlp \
    && chmod a+x /usr/local/bin/yt-dlp \
    && apt-get purge -y curl \
    && apt-get autoremove -y \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# ------- Application -------

WORKDIR /app

# Enable pnpm via Corepack (pin to version used in this project)
RUN corepack enable && corepack prepare pnpm@11.2.2 --activate

# Copy dependency manifests first (leverages Docker cache)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy source files needed to run
COPY main.ts ./
COPY plugins/ ./plugins/
COPY lib/ ./lib/

# Run as non-root user for security
USER node

# Data directory (bind-mount this for persistence)
# The default resolves to /app/data when running from /app
# Example: docker run -v /host/data:/app/data ...
ENV DATA_DIR=

# No EXPOSE needed — this is a WhatsApp bot, no HTTP server

CMD ["node", "main.ts"]
