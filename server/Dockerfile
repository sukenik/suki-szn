FROM node:20-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY server/package*.json ./server/

RUN cd server && npm install

COPY server/ ./server/
COPY shared/ ./shared/

WORKDIR /app/server

RUN npm run build

EXPOSE 3000

CMD ["npm", "run serve"]