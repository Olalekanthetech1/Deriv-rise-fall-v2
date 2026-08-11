# ============================================================
# BASE
# ============================================================
FROM node:22-bookworm-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-dev \
    python3-venv \
    build-essential \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
WORKDIR /app

RUN python -m pip install --upgrade pip setuptools wheel

COPY requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir -r requirements.txt

# ============================================================
# STEP 1 — NODE DEPENDENCIES
# ============================================================
FROM base AS deps

WORKDIR /app
COPY package.json ./
COPY packages/core/package.json ./packages/core/package.json
COPY scripts ./scripts
COPY packages ./packages

RUN npm install --ignore-scripts
RUN npm audit --audit-level=high
RUN npm run postinstall

# ============================================================
# STEP 2 — NEXT.JS BUILDER
# ============================================================
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/packages ./packages
COPY --from=deps /app/scripts ./scripts

ARG APP_SOURCE_REV=dedicated-worker-v1
RUN echo "Building application source revision: ${APP_SOURCE_REV}"

COPY . .

RUN echo "Verifying browser-safe Multi-Model boundaries..." && \
    if grep -nE "from ['\"]@/lib/(multi-model-evaluator|xgboost-daemon|production-ensemble|onnx-engine)|from ['\"].*app/api/" \
      components/custom/signals-drawer.tsx components/custom/multi-model-evaluation-card.tsx; then \
      echo "ERROR: server-only ML dependency detected in a Client Component."; \
      exit 1; \
    fi && \
    echo "Browser-safe Multi-Model boundary check passed."

ARG NEXT_PUBLIC_DERIV_APP_ID
ENV NEXT_PUBLIC_DERIV_APP_ID=$NEXT_PUBLIC_DERIV_APP_ID
ARG NEXT_PUBLIC_DERIV_REDIRECT_URI
ENV NEXT_PUBLIC_DERIV_REDIRECT_URI=$NEXT_PUBLIC_DERIV_REDIRECT_URI
ARG NEXT_PUBLIC_DERIV_APP_NAME
ENV NEXT_PUBLIC_DERIV_APP_NAME=$NEXT_PUBLIC_DERIV_APP_NAME
ARG NEXT_PUBLIC_DERIV_REFERRAL_LINK
ENV NEXT_PUBLIC_DERIV_REFERRAL_LINK=$NEXT_PUBLIC_DERIV_REFERRAL_LINK
ARG NEXT_PUBLIC_DERIV_OAUTH_SCOPES
ENV NEXT_PUBLIC_DERIV_OAUTH_SCOPES=$NEXT_PUBLIC_DERIV_OAUTH_SCOPES
ARG NEXT_PUBLIC_DERIV_ENV
ENV NEXT_PUBLIC_DERIV_ENV=$NEXT_PUBLIC_DERIV_ENV
ARG NEXT_PUBLIC_FONT_FAMILY
ENV NEXT_PUBLIC_FONT_FAMILY=$NEXT_PUBLIC_FONT_FAMILY

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ============================================================
# STEP 3 — PRODUCTION RUNNER
# ============================================================
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV PATH="/opt/venv/bin:$PATH"

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/tsconfig.json ./tsconfig.json

RUN chown -R nextjs:nodejs /app

USER nextjs
CMD ["npm", "run", "start"]
