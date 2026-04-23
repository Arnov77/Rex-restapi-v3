FROM node:20

RUN apt-get update && apt-get install -y \
  chromium \
  libnss3 \
  libxss1 \
  libasound2 \
  libcairo2-dev \
  libpango1.0-dev \
  libjpeg-dev \
  libgif-dev \
  librsvg2-dev \
  build-essential \
  ffmpeg \
  --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

ENV CHROME_BIN=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

COPY package*.json ./

ENV YOUTUBE_DL_SKIP_DOWNLOAD=true

RUN npm ci --legacy-peer-deps

RUN apt-get update && apt-get install -y python3 curl && \
    mkdir -p node_modules/youtube-dl-exec/bin && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o node_modules/youtube-dl-exec/bin/yt-dlp && \
    chmod +x node_modules/youtube-dl-exec/bin/yt-dlp

COPY . .

RUN mkdir -p /app/tmp

EXPOSE 7860

CMD ["node", "server.js"]
