# Phase0 P2P 实测容器：werift 纯 JS WebRTC 双端打洞
FROM node:24-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY auth.js signaling.js peer.js diag.js ./

CMD ["node", "peer.js"]
