# Build local monorepo image
# docker build -t flowise .

# Run image
# docker run -d -p 3000:3000 flowise

# ---------- Stage 1: dependency install ----------
FROM node:20-alpine AS deps

RUN apk update && \
    apk add --no-cache \
        libc6-compat \
        python3 \
        make \
        g++ \
        build-base \
        cairo-dev \
        pango-dev \
        curl && \
    npm install -g pnpm

WORKDIR /usr/src/flowise

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/agentflow/package.json         packages/agentflow/
COPY packages/api-documentation/package.json packages/api-documentation/
COPY packages/components/package.json        packages/components/
COPY packages/server/package.json            packages/server/
COPY packages/ui/package.json                packages/ui/

RUN pnpm install --frozen-lockfile

# ---------- Stage 2: build ----------
FROM deps AS build

COPY . .
RUN pnpm build

# ---------- Stage 3: runtime ----------
FROM node:20-alpine AS runtime

RUN apk update && \
    apk add --no-cache \
        libc6-compat \
        chromium \
        curl && \
    npm install -g pnpm

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV NODE_OPTIONS=--max-old-space-size=8192

WORKDIR /usr/src/flowise

COPY --from=build /usr/src/flowise /usr/src/flowise

RUN chown -R node:node .
USER node

EXPOSE 3000

CMD [ "pnpm", "start" ]
