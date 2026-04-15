FROM node:20-alpine

WORKDIR /app

# v2.1 — cache bust

# Install dashboard deps and build
COPY dashboard/package*.json ./dashboard/
RUN cd dashboard && npm install

COPY dashboard/ ./dashboard/
RUN cd dashboard && npm run build

# Install bot deps
COPY bot/package*.json ./bot/
RUN cd bot && npm install

# Copy bot source
COPY bot/ ./bot/

# Create data dir
RUN mkdir -p /app/data

EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "bot/src/index.js"]
