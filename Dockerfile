FROM node:24-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/providers/package.json packages/providers/package.json
COPY packages/motor-perron/package.json packages/motor-perron/package.json

RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY apps/worker apps/worker
COPY packages packages
COPY prisma prisma
COPY supabase supabase

ENV HOST=0.0.0.0
ENV NODE_ENV=production
ENV STATE_FILE_PATH=/var/data/fbmaniaco-state.json

EXPOSE 4101

CMD ["pnpm", "--filter", "@fbmaniaco/api", "start"]
