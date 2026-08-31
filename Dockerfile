FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

# Cliente do PostgreSQL é necessário para o endpoint de backup (pg_dump)
RUN apk add --no-cache postgresql-client

COPY . .

EXPOSE 3000

CMD ["node", "src/index.js"]
