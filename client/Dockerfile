FROM node:20-alpine AS build-stage

WORKDIR /app

COPY client/package*.json ./client/

RUN cd client && npm install

COPY client/ ./client/
COPY shared/ ./shared/

WORKDIR /app/client

RUN npm run build

FROM nginx:stable-alpine AS production-stage

COPY --from=build-stage /app/client/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]