FROM node:20-alpine AS base
RUN apk add --no-cache python3 python3-dev py3-pip py3-numpy py3-scikit-learn build-base libc6-compat
WORKDIR /app
COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt --break-system-packages

# Step 1: Install dependencies
FROM base AS deps

COPY package.json package-lock.json* bun.lock* ./
COPY packages/core/package.json ./packages/core/package.json
RUN npm install
COPY packages ./packages
COPY scripts ./scripts

# Step 2: Build the Next.js application with Option A Next.js API Routes
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Support dynamic build args for Render build time
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

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build

# Step 3: Production runner
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["npm", "run", "start"]
