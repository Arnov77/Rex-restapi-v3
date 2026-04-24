FROM node:20

RUN apt-get update && apt-get install -y --no-install-recommends \
  chromium \
  libnss3 \
  libxss1 \
  libasound2 \
  ffmpeg \
  python3 \
  curl \
  ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV CHROME_BIN=/usr/bin/chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV YOUTUBE_DL_SKIP_DOWNLOAD=true

WORKDIR /app

COPY package*.json ./

RUN npm ci

RUN mkdir -p node_modules/youtube-dl-exec/bin && \
    curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
      -o node_modules/youtube-dl-exec/bin/yt-dlp && \
    chmod +x node_modules/youtube-dl-exec/bin/yt-dlp

COPY . .

RUN mkdir -p /app/tmp

EXPOSE 7860

CMD ["node", "server.js"]
