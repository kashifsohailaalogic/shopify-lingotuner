FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

# Pehle ALL dependencies install karo (dev bhi)
RUN npm ci && npm cache clean --force

COPY . .

# Prisma generate + Build
RUN npx prisma generate
RUN npm run build

# Ab dev dependencies hata do
RUN npm prune --production

CMD ["npm", "run", "docker-start"]