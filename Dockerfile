# ============================================================
# BASE
# ============================================================
FROM node:20-bookworm-slim AS base

# Install Python and native dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-dev \
    python3-venv \
    build-essential \
    git \
    && rm -rf /var/lib/apt/lists/*

# Create isolated Python environment
RUN python3 -m venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app

# Upgrade Python packaging tools
RUN python -m pip install --upgrade \
    pip \
    setuptools \
    wheel

# Install Python ML dependencies
COPY requirements.txt ./

RUN python -m pip install \
    --no-cache-dir \
    -r requirements.txt


# ============================================================
# STEP 1 — NODE DEPENDENCIES
# ============================================================
FROM base AS deps

WORKDIR /app

COPY package.json package-lock.json* bun.lock* ./
COPY packages/core/package.json ./packages/core/package.json

RUN npm install

COPY packages ./packages
COPY scripts ./scripts


# ============================================================
# STEP 2 — NEXT.JS BUILD
# ============================================================
FROM base AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules

COPY . .

# ------------------------------------------------------------
# Render build arguments
# ------------------------------------------------------------

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

# ------------------------------------------------------------
# Next.js production build
# ------------------------------------------------------------

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

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

# Create non-root user
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs

# Next.js production files
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Python ML dependencies and environment are inherited
# from the base image.

USER nextjs

EXPOSE 3000

CMD ["npm", "run", "start"]
