FROM node:24.15.0-alpine

RUN apk add --no-cache \
    tzdata \
    ffmpeg \
    python3 \
    py3-pip \
    && pip install --break-system-packages --no-cache-dir -U yt-dlp

ENV TZ=Asia/Jakarta

WORKDIR /app

COPY i18n migrations app.js package.json pnpm-workspace.yaml ./

RUN npm install --omit=dev

CMD ["node", "app.js"]
