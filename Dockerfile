FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY backend/package.json backend/package.json
COPY mobile/package.json mobile/package.json

RUN npm ci --include=dev

COPY tsconfig.base.json ./
COPY shared shared
COPY backend backend

RUN npm --workspace @cadencia/backend run build \
  && npm prune --omit=dev

EXPOSE 10000

CMD ["npm", "--workspace", "@cadencia/backend", "run", "start"]
