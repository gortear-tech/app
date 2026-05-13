FROM node:22-bookworm-slim

WORKDIR /app

ENV HOST=0.0.0.0

RUN corepack enable

COPY . .

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @fbmaniaco/shared build \
  && pnpm --filter @fbmaniaco/providers build \
  && pnpm --filter @fbmaniaco/api build \
  && pnpm --filter @fbmaniaco/worker build

ENV NODE_ENV=production

CMD ["node", "scripts/start-render.mjs"]
