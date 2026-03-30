FROM node:22-slim

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json ./
RUN npm ci --production

# Copy application files
COPY server.js index.html ./

# Copy site patterns and embed.js (referenced by server.js via relative paths)
# These are copied at deploy time, not baked into the image
# See deploy.sh for the rsync command

EXPOSE 3001

CMD ["node", "server.js"]
