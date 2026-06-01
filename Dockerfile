# syntax = docker/dockerfile:1

FROM node:24.16-slim AS base

# ------- System Dependencies -------

# Layer 1 — stable system deps (rarely invalidated)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ghostscript \
    python3 \
    python3-pip \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Layer 2 — Python tools (pdf2docx for PDF→DOCX, yt-dlp for media downloads)
RUN pip3 install --break-system-packages --no-cache-dir yt-dlp pdf2docx && \
    yt-dlp --version && pdf2docx --help > /dev/null

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
