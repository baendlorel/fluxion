FROM node:24
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile
RUN pnpm install 
COPY ./dist /app/
WORKDIR /app

RUN curl -fsSL https://code-server.dev/install.sh | sh

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]