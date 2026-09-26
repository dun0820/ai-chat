# syntax=docker/dockerfile:1

# --- deps: 依存関係のインストール (postinstallでprisma generateも実行される) ---
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# --- builder: Next.js standalone ビルド ---
FROM node:24-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
# ビルド時にPrisma Clientが `env("DATABASE_URL")` を解決できるようにするための
# ダミー値。実際のDB接続は行わず、実行時にCloud Run側の環境変数で上書きされる。
ENV DATABASE_URL="mongodb://placeholder/placeholder"
ENV ANTHROPIC_API_KEY="placeholder"
ENV SESSION_COOKIE_NAME="ai_chat_session"

RUN npm run build

# --- runner: 実行に必要な最小限のファイルのみを含む本番イメージ ---
FROM node:24-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Cloud RunはPORTを注入し、コンテナは0.0.0.0でリッスンする必要がある
ENV HOSTNAME=0.0.0.0
ENV PORT=8080

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 8080

CMD ["node", "server.js"]
