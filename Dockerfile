FROM node:24.15.0-alpine

RUN apk add --no-cache \
    tzdata \
    ffmpeg \
    python3 \
    py3-pip \
    && pip install --break-system-packages --no-cache-dir -U yt-dlp

ENV TZ=Asia/Jakarta

WORKDIR /app

COPY package.json pnpm-workspace.yaml ./
COPY i18n/ ./i18n/
COPY migrations/ ./migrations/ 
COPY app.js ./

RUN npm install --omit=dev

CMD ["node", "app.js"]
