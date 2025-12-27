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

RUN npm ci --legacy-peer-deps

COPY . .

RUN mkdir -p /app/tmp

EXPOSE 7860

CMD ["node", "server.js"]
