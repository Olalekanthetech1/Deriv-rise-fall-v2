# ============================================================
# BASE
# ============================================================
FROM node:20-bookworm-slim AS base

# ------------------------------------------------------------
# System dependencies
# ------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-dev \
    python3-venv \
    build-essential \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ------------------------------------------------------------
# Create isolated Python virtual environment
# ------------------------------------------------------------
RUN python3 -m venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app

# ------------------------------------------------------------
# Upgrade Python packaging tools
# ------------------------------------------------------------
RUN python -m pip install --upgrade \
    pip \
    setuptools \
    wheel

# ------------------------------------------------------------
# Install Python ML dependencies
# ------------------------------------------------------------
COPY requirements.txt ./requirements.txt

RUN python -m pip install \
    --no-cache-dir \
    -r requirements.txt


# ============================================================
# STEP 1 — NODE DEPENDENCIES
# ============================================================
FROM base AS deps

WORKDIR /app

# ------------------------------------------------------------
# Copy package manifest
#
# IMPORTANT:
# This project currently does NOT have package-lock.json,
# therefore use npm install rather than npm ci.
# ------------------------------------------------------------
COPY package.json ./

# Workspace/package manifest
COPY packages/core/package.json ./packages/core/package.json

# ------------------------------------------------------------
# Copy scripts BEFORE npm install.
#
# package.json contains:
#
# "postinstall": "node scripts/copy-smartcharts-assets.js"
#
# Therefore the scripts directory must exist before npm
# lifecycle scripts are allowed to execute.
# ------------------------------------------------------------
COPY scripts ./scripts

# ------------------------------------------------------------
# Copy packages required by the project
# ------------------------------------------------------------
COPY packages ./packages

# ------------------------------------------------------------
# Install Node dependencies.
#
# --ignore-scripts prevents postinstall from executing during
# dependency installation.
# ------------------------------------------------------------
RUN npm install --ignore-scripts

# ------------------------------------------------------------
# Now run the project's postinstall explicitly.
#
# At this point:
#   /app/scripts exists
#   /app/packages exists
#   /app/node_modules exists
# ------------------------------------------------------------
RUN npm run postinstall


# ============================================================
# STEP 2 — NEXT.JS BUILDER
# ============================================================
FROM base AS builder

WORKDIR /app

# ------------------------------------------------------------
# Copy installed Node dependencies
# ------------------------------------------------------------
COPY --from=deps /app/node_modules ./node_modules

# ------------------------------------------------------------
# Copy package configuration
# ------------------------------------------------------------
COPY --from=deps /app/package.json ./package.json

# ------------------------------------------------------------
# Copy packages and scripts prepared by deps stage
# ------------------------------------------------------------
COPY --from=deps /app/packages ./packages
COPY --from=deps /app/scripts ./scripts

# ------------------------------------------------------------
# Copy the rest of the application
# ------------------------------------------------------------
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
# Next.js production configuration
# ------------------------------------------------------------
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# ------------------------------------------------------------
# Build application
# ------------------------------------------------------------
RUN npm run build


# ============================================================
# STEP 3 — PRODUCTION RUNNER
# ============================================================
FROM base AS runner

WORKDIR /app

# ------------------------------------------------------------
# Runtime environment
# ------------------------------------------------------------
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV PATH="/opt/venv/bin:$PATH"

# ------------------------------------------------------------
# Create non-root runtime user
# ------------------------------------------------------------
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs

# ------------------------------------------------------------
# Next.js production output
# ------------------------------------------------------------
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next

# ------------------------------------------------------------
# Node dependencies
# ------------------------------------------------------------
COPY --from=builder /app/node_modules ./node_modules

# ------------------------------------------------------------
# Application metadata
# ------------------------------------------------------------
COPY --from=builder /app/package.json ./package.json

# ------------------------------------------------------------
# Application packages
# ------------------------------------------------------------
COPY --from=builder /app/packages ./packages

# ------------------------------------------------------------
# Scripts
# ------------------------------------------------------------
COPY --from=builder /app/scripts ./scripts

# ------------------------------------------------------------
# Ensure runtime user owns application files
# ------------------------------------------------------------
RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

# ------------------------------------------------------------
# Start Next.js
# ------------------------------------------------------------
CMD ["npm", "run", "start"]
