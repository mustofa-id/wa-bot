FROM ghcr.io/puppeteer/puppeteer:25.0.4

USER root

RUN apt-get update && apt-get install -y \
    tzdata \
    ffmpeg \
    python3 \
    python3-pip \
    && pip3 install --break-system-packages --no-cache-dir -U yt-dlp \
    && rm -rf /var/lib/apt/lists/*

ENV TZ=Asia/Jakarta

WORKDIR /app

COPY package.json pnpm-workspace.yaml ./
COPY i18n/ ./i18n/
COPY migrations/ ./migrations/
COPY app.js ./

RUN mkdir data
RUN corepack enable pnpm
RUN pnpm i --prefer-offline --prod

# hard to handle permission with this :')
# USER pptruser

CMD ["node", "app.js"]

# build: docker build -t wa-bot:latest .
# run: docker run -d --cpus="0.7" --env-file .env --name wa-bot -v $(pwd)/data:/app/data wa-bot:latest
