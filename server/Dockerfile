FROM node:20-alpine AS builder

WORKDIR /app

COPY server/package*.json ./server/
RUN cd server && npm install

COPY server/ ./server/
COPY shared/ ./shared/

WORKDIR /app/server
RUN npm run build

FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

COPY --from=builder /app/server/dist ./server/dist

WORKDIR /app/server

EXPOSE 3000

CMD ["node", "dist/server/src/index.js"]